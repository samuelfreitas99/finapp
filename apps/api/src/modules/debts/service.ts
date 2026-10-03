import {
  debtInstallmentStatus,
  debtSchedule,
  debtSummary,
  endOfMonth,
  monthlyRateFromAnnual,
  type DebtInstallmentState,
  type DebtPhase,
  type DebtScheduleRow,
  type ISODate,
} from '@finapp/core';
import type {
  DebtInstallmentDto,
  DebtPhaseBody,
  DebtSummaryDto,
  debtBodySchema,
} from '@finapp/shared';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { z } from 'zod';
import { debtInstallments, debtPhases, debts, transactions } from '../../db/schema';
import type { DbExecutor } from '../../db/seed';
import { badRequest, notFound } from '../../http/errors';
import { ensureInvoice, findCard, invoiceMonthFor } from '../cards/service';
import { systemCategoryId } from '../categories/routes';

export type DebtBodyParsed = z.output<typeof debtBodySchema>;
type PhaseParsed = DebtBodyParsed['phases'][number];
export type DebtRow = typeof debts.$inferSelect;
export type PhaseRow = typeof debtPhases.$inferSelect;
export type InstallmentRow = typeof debtInstallments.$inferSelect;

export const rateOf = (p: Pick<DebtPhaseBody, 'rateMonthly' | 'rateAnnual'>) =>
  p.rateMonthly ?? (p.rateAnnual !== undefined ? monthlyRateFromAnnual(p.rateAnnual) : 0);

/** Fase do corpo da requisição no formato do core. */
export function toCorePhase(p: PhaseParsed): DebtPhase {
  switch (p.system) {
    case 'fixed':
      return {
        system: 'fixed',
        firstDueDate: p.firstDueDate,
        installments: p.installments ?? 1,
        ...(p.installmentAmount !== undefined ? { amount: p.installmentAmount } : {}),
        ...(p.total !== undefined ? { total: p.total } : {}),
        startsAfterCompletion: p.startsAfterCompletion,
      };
    case 'price':
    case 'sac':
      return {
        system: p.system,
        principal: p.principal ?? 0,
        monthlyRate: rateOf(p),
        installments: p.installments ?? 1,
        firstDueDate: p.firstDueDate,
        startsAfterCompletion: p.startsAfterCompletion,
      };
    case 'variable':
      return {
        system: 'variable',
        firstDueDate: p.firstDueDate,
        values: p.values ?? [],
        ...(p.lastMonth ? { lastMonth: p.lastMonth } : {}),
        endsAtCompletion: p.endsAtCompletion,
      };
    case 'balloon':
      return { system: 'balloon', payments: p.payments ?? [] };
  }
}

/** Cronograma completo pela regra do core (400 se os dados não fecham). */
export function scheduleOf(
  phases: readonly DebtPhase[],
  completionDate: ISODate | null | undefined,
): DebtScheduleRow[] {
  try {
    return debtSchedule(phases, completionDate ?? null);
  } catch (err) {
    if (err instanceof RangeError) throw badRequest('invalid_debt', err.message);
    throw err;
  }
}

type InstallmentState = Pick<
  InstallmentRow,
  'dueDate' | 'amount' | 'principalPart' | 'interestPart' | 'paidAmount' | 'status'
>;

const stateOf = (i: InstallmentState): DebtInstallmentState => ({
  dueDate: i.dueDate,
  amount: i.amount,
  principalPart: i.principalPart,
  interestPart: i.interestPart,
  paidAmount: i.paidAmount,
  paid: i.status === 'paid',
});

export const summaryOf = (rows: readonly InstallmentState[], today: ISODate): DebtSummaryDto =>
  debtSummary(rows.map(stateOf), today);

/** Parcelas com status do dia (atrasada é calculada) e número dentro da fase. */
export function toInstallmentDtos(
  rows: readonly InstallmentRow[],
  today: ISODate,
): DebtInstallmentDto[] {
  const counter = new Map<string, number>();
  return [...rows]
    .sort((a, b) => a.number - b.number)
    .map((r) => {
      const n = (counter.get(r.phaseId) ?? 0) + 1;
      counter.set(r.phaseId, n);
      return {
        id: r.id,
        phaseId: r.phaseId,
        number: r.number,
        phaseNumber: n,
        dueDate: r.dueDate,
        amount: r.amount,
        principalPart: r.principalPart,
        interestPart: r.interestPart,
        estimated: r.estimated,
        paidAmount: r.paidAmount,
        paidDate: r.paidDate,
        discount: r.discount,
        status: debtInstallmentStatus(stateOf(r), today),
      };
    });
}

export async function findDebt(db: DbExecutor, spaceId: string, id: string) {
  const [row] = await db
    .select()
    .from(debts)
    .where(and(eq(debts.id, id), eq(debts.spaceId, spaceId), isNull(debts.deletedAt)));
  if (!row) throw notFound('Dívida');
  return row;
}

export async function installmentsOf(db: DbExecutor, debtId: string) {
  return db
    .select()
    .from(debtInstallments)
    .where(and(eq(debtInstallments.debtId, debtId), isNull(debtInstallments.deletedAt)));
}

export async function phasesOf(db: DbExecutor, debtId: string) {
  const rows = await db
    .select()
    .from(debtPhases)
    .where(and(eq(debtPhases.debtId, debtId), isNull(debtPhases.deletedAt)));
  return rows.sort((a, b) => a.position - b.position);
}

/** Descrição do lançamento de uma parcela. */
export function installmentLabel(
  debt: Pick<DebtRow, 'name'>,
  phase: Pick<PhaseRow, 'name'>,
  multiPhase: boolean,
  phaseNumber: number,
  phaseTotal: number,
) {
  return multiPhase
    ? `${debt.name}: ${phase.name} (${phaseNumber}/${phaseTotal})`
    : `${debt.name} (${phaseNumber}/${phaseTotal})`;
}

/**
 * Lançamentos previstos das parcelas pendentes: na conta de pagamento (despesa se devo,
 * receita se me devem) ou como itens das faturas do cartão. Sem conta nem cartão, a
 * dívida só aparece no painel. Recria os previstos ainda não pagos (idempotente).
 * @see RN 6.3
 */
export async function syncPlannedEntries(
  db: DbExecutor,
  debt: DebtRow,
  today: ISODate,
  userId: string | null,
) {
  const [rows, phases, all] = await Promise.all([
    installmentsOf(db, debt.id),
    phasesOf(db, debt.id),
    // Inclui parcelas substituídas (amortização, quitação): os previstos delas também saem.
    db
      .select({ id: debtInstallments.id })
      .from(debtInstallments)
      .where(eq(debtInstallments.debtId, debt.id)),
  ]);
  const ids = all.map((r) => r.id);
  if (ids.length) {
    await db
      .update(transactions)
      .set({ deletedAt: new Date() })
      .where(
        and(
          inArray(transactions.debtInstallmentId, ids),
          eq(transactions.status, 'planned'),
          isNull(transactions.deletedAt),
        ),
      );
  }
  if (debt.status !== 'active' || (!debt.paymentAccountId && !debt.paymentCardId)) return;
  const card = debt.paymentCardId ? await findCard(db, debt.spaceId, debt.paymentCardId) : null;
  const categoryId = await systemCategoryId(db, debt.spaceId, 'loan');
  const dtos = toInstallmentDtos(rows, today);
  // Parcelas que já têm lançamento efetivado (pago fora da tela da dívida, inclusive dados
  // de antes desta regra): conta o pagamento na parcela em vez de lançar de novo.
  const settledRows = ids.length
    ? await db
        .select({
          id: transactions.id,
          installmentId: transactions.debtInstallmentId,
          amount: transactions.amount,
          date: transactions.date,
        })
        .from(transactions)
        .where(
          and(
            inArray(transactions.debtInstallmentId, ids),
            eq(transactions.status, 'settled'),
            isNull(transactions.deletedAt),
          ),
        )
    : [];
  const settledFor = new Map(settledRows.map((r) => [r.installmentId, r]));
  const phaseById = new Map(phases.map((p) => [p.id, p]));
  const perPhase = new Map<string, number>();
  for (const d of dtos) perPhase.set(d.phaseId, (perPhase.get(d.phaseId) ?? 0) + 1);
  for (const d of dtos) {
    if (d.status === 'paid' || d.amount - d.paidAmount <= 0) continue;
    const already = settledFor.get(d.id);
    if (already && d.paidAmount === 0) {
      await recordInstallmentPayment(db, {
        installmentId: d.id,
        amount: already.amount,
        date: already.date,
        transactionId: already.id,
        today,
        userId,
        resync: false,
      });
      continue;
    }
    const phase = phaseById.get(d.phaseId);
    if (!phase) continue;
    const invoiceId = card
      ? (await ensureInvoice(db, card, await invoiceMonthFor(db, card, d.dueDate), userId)).id
      : null;
    const settled = card ? d.dueDate <= today : false;
    const [entry] = await db
      .insert(transactions)
      .values({
        spaceId: debt.spaceId,
        createdBy: userId,
        type: debt.direction === 'owed_to_me' ? 'income' : 'expense',
        status: settled ? 'settled' : 'planned',
        amount: d.amount - d.paidAmount,
        date: d.dueDate,
        description: installmentLabel(
          debt,
          phase,
          phases.length > 1,
          d.phaseNumber,
          perPhase.get(d.phaseId) ?? 0,
        ),
        accountId: card ? null : debt.paymentAccountId,
        cardId: card?.id ?? null,
        invoiceId,
        categoryId,
        paymentMethod: card ? 'credit' : null,
        debtInstallmentId: d.id,
        estimated: d.estimated,
        settledAt: settled ? new Date() : null,
      })
      .returning({ id: transactions.id });
    // No cartão, a parcela que já venceu está na fatura: conta como paga na dívida.
    if (settled && entry) {
      await recordInstallmentPayment(db, {
        installmentId: d.id,
        amount: d.amount - d.paidAmount,
        date: d.dueDate,
        transactionId: entry.id,
        today,
        userId,
        resync: false,
      });
    }
  }
}

/** Grava a dívida, as fases e as parcelas do cronograma. */
export async function insertDebt(
  db: DbExecutor,
  spaceId: string,
  userId: string,
  body: DebtBodyParsed,
  rows: readonly DebtScheduleRow[],
): Promise<DebtRow> {
  const principal =
    body.principal ??
    body.phases.reduce(
      (s, p) => s + (p.principal ?? p.total ?? (p.installmentAmount ?? 0) * (p.installments ?? 0)),
      0,
    );
  const [debt] = await db
    .insert(debts)
    .values({
      spaceId,
      createdBy: userId,
      name: body.name,
      direction: body.direction,
      kind: body.kind,
      contactId: body.contactId ?? null,
      institution: body.institution ?? null,
      principal,
      paymentAccountId: body.paymentAccountId ?? null,
      paymentCardId: body.paymentCardId ?? null,
      completionDate: body.completionDate ?? null,
      completionDeadline: body.completionDeadline ?? null,
      assetValue: body.assetValue ?? null,
      notes: body.notes ?? null,
    })
    .returning();
  if (!debt) throw new Error('falha ao criar dívida');

  const phaseIds: string[] = [];
  for (const [i, p] of body.phases.entries()) {
    const phaseRows = rows.filter((r) => r.phase === i);
    const [phase] = await db
      .insert(debtPhases)
      .values({
        spaceId,
        createdBy: userId,
        debtId: debt.id,
        position: i + 1,
        name: p.name,
        system: p.system,
        principal: p.principal ?? null,
        rateMonthly: rateOf(p),
        index: p.index,
        installments: phaseRows.length || (p.installments ?? null),
        startDate: phaseRows[0]?.dueDate ?? p.firstDueDate,
        endDate:
          p.system === 'variable' && p.lastMonth && !p.endsAtCompletion
            ? endOfMonth(`${p.lastMonth}-01`)
            : null,
        installmentAmount: p.installmentAmount ?? null,
        endsAtCompletion: p.endsAtCompletion,
        startsAfterCompletion: p.startsAfterCompletion,
      })
      .returning();
    if (!phase) throw new Error('falha ao criar fase');
    phaseIds.push(phase.id);
  }

  if (rows.length) {
    await db.insert(debtInstallments).values(
      rows.map((r) => {
        const paid = r.number <= body.paidInstallments;
        return {
          spaceId,
          createdBy: userId,
          debtId: debt.id,
          phaseId: phaseIds[r.phase] as string,
          number: r.number,
          dueDate: r.dueDate,
          amount: r.amount,
          principalPart: r.principalPart,
          interestPart: r.interestPart,
          estimated: r.estimated ?? false,
          paidAmount: paid ? r.amount : 0,
          paidDate: paid ? r.dueDate : null,
          status: paid ? ('paid' as const) : ('pending' as const),
        };
      }),
    );
  }
  return debt;
}

/**
 * Um lançamento ligado a uma parcela foi efetivado fora da tela da dívida ("Confirmar" em
 * Lançamentos, importação de extrato, parcela no cartão que chegou na fatura): registra o
 * pagamento na parcela, quita a dívida se era a última e, se ficou parcial, refaz o previsto
 * do restante. Parcela já paga não muda.
 * @see RN 6.3
 */
export async function recordInstallmentPayment(
  db: DbExecutor,
  {
    installmentId,
    amount,
    date,
    transactionId,
    today,
    userId,
    resync = true,
  }: {
    installmentId: string;
    amount: number;
    date: ISODate;
    transactionId: string;
    today: ISODate;
    userId: string | null;
    /** `false` quando quem chama já está dentro de `syncPlannedEntries`. */
    resync?: boolean;
  },
) {
  const [inst] = await db
    .select()
    .from(debtInstallments)
    .where(and(eq(debtInstallments.id, installmentId), isNull(debtInstallments.deletedAt)));
  if (!inst || inst.status === 'paid') return;
  const paidAmount = inst.paidAmount + amount;
  const fully = paidAmount + inst.discount >= inst.amount;
  await db
    .update(debtInstallments)
    .set({ paidAmount, paidDate: date, status: fully ? 'paid' : 'partial', transactionId })
    .where(eq(debtInstallments.id, inst.id));
  const [debt] = await db.select().from(debts).where(eq(debts.id, inst.debtId));
  if (!debt) return;
  const rows = await installmentsOf(db, debt.id);
  if (rows.length && rows.every((r) => r.status === 'paid')) {
    await db.update(debts).set({ status: 'paid_off' }).where(eq(debts.id, debt.id));
    await syncPlannedEntries(db, { ...debt, status: 'paid_off' }, today, userId);
  } else if (!fully && resync) {
    await syncPlannedEntries(db, debt, today, userId);
  }
}
