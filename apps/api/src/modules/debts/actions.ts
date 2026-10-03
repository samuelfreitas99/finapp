import {
  amortizeExtra,
  compareDates,
  debtInstallmentStatus,
  diffYearMonths,
  earlyPaymentDiscount,
  payoffAmount,
  planAdvance,
  yearMonthOf,
  type ISODate,
} from '@finapp/core';
import {
  advanceBodySchema,
  amortizeBodySchema,
  debtInstallmentParamsSchema,
  payInstallmentBodySchema,
  payoffBodySchema,
  simulatePayoffBodySchema,
  type SimulatePayoff,
  spaceItemParamsSchema,
} from '@finapp/shared';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { debtEvents, debtInstallments, debts, transactions } from '../../db/schema';
import type { DbExecutor } from '../../db/seed';
import { badRequest, notFound } from '../../http/errors';
import { currentUser } from '../../plugins/auth';
import { accountForEntry } from '../accounts/service';
import { systemCategoryId } from '../categories/routes';
import type { SpaceContext } from '../spaces/scope';
import {
  findDebt,
  installmentsOf,
  phasesOf,
  syncPlannedEntries,
  type DebtRow,
  type InstallmentRow,
} from './service';

const isPaid = (i: InstallmentRow) => i.status === 'paid';

/**
 * Pagar parcela (inclusive adiantada, com desconto), amortização extraordinária e
 * quitação total.
 * @see RN 6.3, 6.5
 */
export function debtActionRoutes(
  app: FastifyInstance,
  { db, today }: SpaceContext,
  detail: (spaceId: string, id: string) => Promise<unknown>,
) {
  const assertSettledDate = (date: ISODate) => {
    if (compareDates(date, today()) > 0) {
      throw badRequest('settled_in_future', 'O pagamento não pode ter data futura.');
    }
  };

  /** Lançamento efetivado do dinheiro que saiu (ou entrou, se me devem). */
  const moneyEntry = async (
    tx: DbExecutor,
    debt: DebtRow,
    {
      amount,
      date,
      accountId,
      description,
      installmentId,
      userId,
    }: {
      amount: number;
      date: ISODate;
      accountId: string;
      description: string;
      installmentId: string | null;
      userId: string;
    },
  ) => {
    await accountForEntry(tx, debt.spaceId, accountId, date);
    const [row] = await tx
      .insert(transactions)
      .values({
        spaceId: debt.spaceId,
        createdBy: userId,
        type: debt.direction === 'owed_to_me' ? 'income' : 'expense',
        status: 'settled',
        amount,
        date,
        description,
        accountId,
        categoryId: await systemCategoryId(tx, debt.spaceId, 'loan'),
        debtInstallmentId: installmentId,
        settledAt: new Date(),
      })
      .returning();
    if (!row) throw new Error('falha ao lançar pagamento');
    return row;
  };

  const markPaidOffIfDone = async (tx: DbExecutor, debt: DebtRow) => {
    const rows = await installmentsOf(tx, debt.id);
    if (rows.length && rows.every(isPaid)) {
      await tx.update(debts).set({ status: 'paid_off' }).where(eq(debts.id, debt.id));
    }
  };

  app.post('/debts/:id/installments/:number/pay', async (request) => {
    const { spaceId, id, number } = debtInstallmentParamsSchema.parse(request.params);
    const body = payInstallmentBodySchema.parse(request.body ?? {});
    const userId = currentUser(request).id;
    const t = today();
    const date = body.date ?? t;
    assertSettledDate(date);
    await db.transaction(async (tx) => {
      const debt = await findDebt(tx, spaceId, id);
      if (debt.status !== 'active')
        throw badRequest('debt_not_active', 'Esta dívida não está ativa.');
      const rows = await installmentsOf(tx, debt.id);
      const inst = rows.find((r) => r.number === number);
      if (!inst) throw notFound('Parcela');
      if (isPaid(inst)) throw badRequest('already_paid', 'Esta parcela já está paga.');
      const open = inst.amount - inst.paidAmount - inst.discount;

      let discount = body.discount ?? 0;
      if (body.discountMonthlyRate !== undefined) {
        const months = Math.max(0, diffYearMonths(yearMonthOf(date), yearMonthOf(inst.dueDate)));
        discount = earlyPaymentDiscount(open, body.discountMonthlyRate, months);
      }
      const amount = body.amount ?? open - discount;
      if (amount <= 0) throw badRequest('invalid_amount', 'Nada a pagar nesta parcela.');
      if (amount + discount > open) {
        throw badRequest('invalid_amount', 'O pagamento passa do valor da parcela.');
      }

      // O previsto da parcela vira o pagamento; se não houver, lança na conta informada.
      const [planned] = await tx
        .select()
        .from(transactions)
        .where(
          and(
            eq(transactions.debtInstallmentId, inst.id),
            eq(transactions.status, 'planned'),
            isNull(transactions.deletedAt),
          ),
        );
      let transactionId: string | null = null;
      const accountId = body.accountId ?? planned?.accountId ?? debt.paymentAccountId;
      if (planned && (planned.cardId || !body.accountId || body.accountId === planned.accountId)) {
        if (planned.accountId) await accountForEntry(tx, spaceId, planned.accountId, date);
        await tx
          .update(transactions)
          .set({ status: 'settled', amount, date, settledAt: new Date(), estimated: false })
          .where(eq(transactions.id, planned.id));
        transactionId = planned.id;
      } else if (accountId) {
        transactionId = (
          await moneyEntry(tx, debt, {
            amount,
            date,
            accountId,
            description: planned?.description ?? `${debt.name} (parcela ${inst.number})`,
            installmentId: inst.id,
            userId,
          })
        ).id;
        if (planned) {
          await tx
            .update(transactions)
            .set({ deletedAt: new Date() })
            .where(eq(transactions.id, planned.id));
        }
      }

      const paidAmount = inst.paidAmount + amount;
      const totalDiscount = inst.discount + discount;
      const fully = paidAmount + totalDiscount >= inst.amount;
      await tx
        .update(debtInstallments)
        .set({
          paidAmount,
          discount: totalDiscount,
          paidDate: date,
          status: fully ? 'paid' : 'partial',
          ...(transactionId ? { transactionId } : {}),
        })
        .where(eq(debtInstallments.id, inst.id));
      await syncPlannedEntries(tx, debt, t, userId);
      await markPaidOffIfDone(tx, debt);
    });
    return detail(spaceId, id);
  });

  /**
   * Adiantar várias parcelas futuras de uma vez (das próximas ou das últimas), com o total
   * cobrado pelo banco ou uma taxa de desconto. Um único lançamento na conta; as parcelas
   * ficam pagas com o desconto repartido (`planAdvance` no core).
   */
  app.post('/debts/:id/advance', async (request) => {
    const { spaceId, id } = spaceItemParamsSchema.parse(request.params);
    const body = advanceBodySchema.parse(request.body ?? {});
    const userId = currentUser(request).id;
    const t = today();
    const date = body.date ?? t;
    assertSettledDate(date);
    await db.transaction(async (tx) => {
      const debt = await findDebt(tx, spaceId, id);
      if (debt.status !== 'active')
        throw badRequest('debt_not_active', 'Esta dívida não está ativa.');
      const rows = await installmentsOf(tx, debt.id);
      // Só parcelas que ainda vão vencer e sem pagamento parcial.
      const candidates = rows.filter(
        (r) => !isPaid(r) && r.paidAmount === 0 && compareDates(r.dueDate, date) > 0,
      );
      let items;
      try {
        items = planAdvance({
          candidates: candidates.map((r) => ({
            id: r.id,
            dueDate: r.dueDate,
            open: r.amount - r.discount,
          })),
          count: body.count,
          from: body.from,
          date,
          ...(body.total !== undefined ? { total: body.total } : {}),
          ...(body.discountMonthlyRate !== undefined
            ? { monthlyRate: body.discountMonthlyRate }
            : {}),
        });
      } catch (err) {
        throw badRequest(
          'invalid_advance',
          err instanceof RangeError ? err.message : 'Pedido inválido.',
        );
      }
      const total = items.reduce((s, i) => s + i.pay, 0);
      const accountId = body.accountId ?? debt.paymentAccountId;
      const entry = accountId
        ? await moneyEntry(tx, debt, {
            amount: total,
            date,
            accountId,
            description: `Adiantamento: ${debt.name} (${items.length} parcela${items.length > 1 ? 's' : ''})`,
            installmentId: null,
            userId,
          })
        : null;
      const byId = new Map(candidates.map((r) => [r.id, r]));
      for (const item of items) {
        const row = byId.get(item.id) as InstallmentRow;
        await tx
          .update(debtInstallments)
          .set({
            paidAmount: item.pay,
            discount: row.discount + item.discount,
            paidDate: date,
            status: 'paid',
            ...(entry ? { transactionId: entry.id } : {}),
          })
          .where(eq(debtInstallments.id, item.id));
      }
      await syncPlannedEntries(tx, debt, t, userId);
      await markPaidOffIfDone(tx, debt);
    });
    return detail(spaceId, id);
  });

  /**
   * Simulação (nada é gravado): quanto custa quitar hoje e o que muda ao amortizar um valor
   * extra, nas duas opções (menos parcelas ou parcela menor).
   */
  app.post('/debts/:id/simulate', async (request): Promise<SimulatePayoff> => {
    const { spaceId, id } = spaceItemParamsSchema.parse(request.params);
    const body = simulatePayoffBodySchema.parse(request.body ?? {});
    const debt = await findDebt(db, spaceId, id);
    if (debt.status !== 'active')
      throw badRequest('debt_not_active', 'Esta dívida não está ativa.');
    const rows = await installmentsOf(db, debt.id);
    const open = rows.filter((r) => !isPaid(r));
    if (open.length === 0) throw badRequest('nothing_to_pay', 'Não há parcelas em aberto.');
    const remainingAmount = open.reduce((s, r) => s + (r.amount - r.paidAmount), 0);
    const interestToPay = open.reduce((s, r) => s + r.interestPart, 0);
    const balance = payoffAmount(open.map((r) => ({ ...r, paid: false })));
    const lastDue = (list: { dueDate: ISODate }[]) =>
      list.reduce<ISODate | null>(
        (m, r) => (m === null || compareDates(r.dueDate, m) > 0 ? r.dueDate : m),
        null,
      );

    let amortization: SimulatePayoff['amortization'] = null;
    if (body.amount !== undefined) {
      const phases = await phasesOf(db, debt.id);
      const candidates = phases.filter(
        (p) => (p.system === 'price' || p.system === 'sac') && open.some((r) => r.phaseId === p.id),
      );
      const phase = body.phaseId ? candidates.find((p) => p.id === body.phaseId) : candidates[0];
      if (!phase || (!body.phaseId && candidates.length > 1)) {
        throw badRequest(
          'invalid_phase',
          candidates.length > 1
            ? 'Escolha a fase (Price ou SAC) a simular.'
            : 'Só fases Price ou SAC com parcelas em aberto podem ser amortizadas.',
        );
      }
      const pending = open
        .filter((r) => r.phaseId === phase.id)
        .sort((a, b) => a.number - b.number);
      if (pending.some((r) => r.paidAmount > 0)) {
        throw badRequest('partial_installment', 'Termine de pagar a parcela parcial antes.');
      }
      const phaseBalance = payoffAmount(pending.map((r) => ({ ...r, paid: false })));
      if (body.amount >= phaseBalance) {
        throw badRequest('invalid_amount', 'O valor cobre o saldo devedor: veja a quitação.');
      }
      const phaseRemaining = pending.reduce((s, r) => s + r.amount, 0);
      const first = pending[0] as InstallmentRow;
      const scenario = (mode: 'reduce_term' | 'reduce_installment') => {
        const next = amortizeExtra({
          system: phase.system as 'price' | 'sac',
          balance: phaseBalance,
          monthlyRate: phase.rateMonthly,
          remainingInstallments: pending.length,
          extra: body.amount as number,
          mode,
          nextDueDate: first.dueDate,
        });
        const after = next.reduce((s, r) => s + r.amount, 0);
        return {
          count: next.length,
          installment: next[0]?.amount ?? 0,
          lastDueDate: lastDue(next),
          remainingAmount: after,
          interestSaved: phaseRemaining - ((body.amount as number) + after),
        };
      };
      amortization = {
        phaseId: phase.id,
        phaseName: phase.name,
        amount: body.amount,
        reduceTerm: scenario('reduce_term'),
        reduceInstallment: scenario('reduce_installment'),
      };
    }
    return {
      current: {
        remainingCount: open.length,
        remainingAmount,
        interestToPay,
        lastDueDate: lastDue(open),
      },
      payoff: { pay: balance, saves: remainingAmount - balance },
      amortization,
    };
  });

  /**
   * Amortização extraordinária (price/sac): o valor abate o saldo devedor da fase e as
   * parcelas pendentes são recalculadas (`reduce_term` mantém a parcela e tira parcelas
   * do fim; `reduce_installment` mantém o prazo).
   */
  app.post('/debts/:id/amortize', async (request) => {
    const { spaceId, id } = spaceItemParamsSchema.parse(request.params);
    const body = amortizeBodySchema.parse(request.body ?? {});
    const userId = currentUser(request).id;
    const t = today();
    const date = body.date ?? t;
    assertSettledDate(date);
    await db.transaction(async (tx) => {
      const debt = await findDebt(tx, spaceId, id);
      if (debt.status !== 'active')
        throw badRequest('debt_not_active', 'Esta dívida não está ativa.');
      const phases = await phasesOf(tx, debt.id);
      const rows = await installmentsOf(tx, debt.id);
      const candidates = phases.filter(
        (p) =>
          (p.system === 'price' || p.system === 'sac') &&
          rows.some((r) => r.phaseId === p.id && !isPaid(r)),
      );
      const phase = body.phaseId ? candidates.find((p) => p.id === body.phaseId) : candidates[0];
      if (!phase || (!body.phaseId && candidates.length > 1)) {
        throw badRequest(
          'invalid_phase',
          candidates.length > 1
            ? 'Escolha a fase (Price ou SAC) a amortizar.'
            : 'Só fases Price ou SAC com parcelas pendentes podem ser amortizadas.',
        );
      }
      const pending = rows
        .filter((r) => r.phaseId === phase.id && !isPaid(r))
        .sort((a, b) => a.number - b.number);
      if (pending.some((r) => r.paidAmount > 0)) {
        throw badRequest(
          'partial_installment',
          'Termine de pagar a parcela parcial antes de amortizar.',
        );
      }
      const balance = payoffAmount(pending.map((r) => ({ ...r, paid: false })));
      if (body.amount > balance) {
        throw badRequest('invalid_amount', 'O valor passa do saldo devedor; use a quitação.');
      }
      const first = pending[0] as InstallmentRow;
      const newRows = amortizeExtra({
        system: phase.system as 'price' | 'sac',
        balance,
        monthlyRate: phase.rateMonthly,
        remainingInstallments: pending.length,
        extra: body.amount,
        mode: body.mode,
        nextDueDate: first.dueDate,
      });

      const accountId = body.accountId ?? debt.paymentAccountId;
      if (accountId) {
        await moneyEntry(tx, debt, {
          amount: body.amount,
          date,
          accountId,
          description: `Amortização: ${debt.name}`,
          installmentId: null,
          userId,
        });
      }
      await tx
        .update(debtInstallments)
        .set({ deletedAt: new Date() })
        .where(
          inArray(
            debtInstallments.id,
            pending.map((r) => r.id),
          ),
        );
      if (newRows.length) {
        await tx.insert(debtInstallments).values(
          newRows.map((r, k) => ({
            spaceId,
            createdBy: userId,
            debtId: debt.id,
            phaseId: phase.id,
            number: first.number + k,
            dueDate: r.dueDate,
            amount: r.amount,
            principalPart: r.principalPart,
            interestPart: r.interestPart,
          })),
        );
      }
      await renumber(tx, debt.id);
      await tx.insert(debtEvents).values({
        spaceId,
        debtId: debt.id,
        type: 'amortization',
        amount: body.amount,
        date,
        createdBy: userId,
        data: {
          mode: body.mode,
          phaseId: phase.id,
          before: { count: pending.length, installment: first.amount },
          after: { count: newRows.length, installment: newRows[0]?.amount ?? 0 },
        },
      });
      await syncPlannedEntries(tx, debt, t, userId);
      await markPaidOffIfDone(tx, debt);
    });
    return detail(spaceId, id);
  });

  /** Quitação total: paga o saldo devedor e encerra as parcelas pendentes. */
  app.post('/debts/:id/payoff', async (request) => {
    const { spaceId, id } = spaceItemParamsSchema.parse(request.params);
    const body = payoffBodySchema.parse(request.body ?? {});
    const userId = currentUser(request).id;
    const t = today();
    const date = body.date ?? t;
    assertSettledDate(date);
    await db.transaction(async (tx) => {
      const debt = await findDebt(tx, spaceId, id);
      if (debt.status !== 'active')
        throw badRequest('debt_not_active', 'Esta dívida não está ativa.');
      const rows = await installmentsOf(tx, debt.id);
      const open = rows.filter((r) => !isPaid(r));
      const amount = payoffAmount(open.map((r) => ({ ...r, paid: false })));
      const accountId = body.accountId ?? debt.paymentAccountId;
      if (amount > 0 && accountId) {
        await moneyEntry(tx, debt, {
          amount,
          date,
          accountId,
          description: `Quitação: ${debt.name}`,
          installmentId: null,
          userId,
        });
      }
      if (open.length) {
        await tx
          .update(debtInstallments)
          .set({ deletedAt: new Date() })
          .where(
            inArray(
              debtInstallments.id,
              open.map((r) => r.id),
            ),
          );
      }
      await tx.update(debts).set({ status: 'paid_off' }).where(eq(debts.id, debt.id));
      await tx.insert(debtEvents).values({
        spaceId,
        debtId: debt.id,
        type: 'payoff',
        amount,
        date,
        createdBy: userId,
        data: {
          cancelledInstallments: open.length,
          lateAtPayoff: open.filter(
            (r) => debtInstallmentStatus({ ...r, paid: false }, t) === 'late',
          ).length,
        },
      });
      await syncPlannedEntries(tx, { ...debt, status: 'paid_off' }, t, userId);
    });
    return detail(spaceId, id);
  });
}

/** Numeração 1..N da dívida pela ordem de vencimento (depois de recalcular parcelas). */
async function renumber(tx: DbExecutor, debtId: string) {
  const rows = (await installmentsOf(tx, debtId)).sort(
    (a, b) => compareDates(a.dueDate, b.dueDate) || a.number - b.number,
  );
  for (const [k, r] of rows.entries()) {
    if (r.number !== k + 1) {
      await tx
        .update(debtInstallments)
        .set({ number: k + 1 })
        .where(eq(debtInstallments.id, r.id));
    }
  }
}
