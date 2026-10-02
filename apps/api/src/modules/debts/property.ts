import { applyIndexCorrection, compareDates, type DebtPhase, type ISODate } from '@finapp/core';
import {
  applyIndexBodySchema,
  completionDateBodySchema,
  debtPhaseParamsSchema,
  indexValueBodySchema,
  phaseValueBodySchema,
  spaceItemParamsSchema,
} from '@finapp/shared';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { debtEvents, debtInstallments, debtPhases, debts, indexValues } from '../../db/schema';
import type { DbExecutor } from '../../db/seed';
import { badRequest, notFound } from '../../http/errors';
import { currentUser } from '../../plugins/auth';
import type { SpaceContext } from '../spaces/scope';
import {
  findDebt,
  installmentsOf,
  phasesOf,
  scheduleOf,
  syncPlannedEntries,
  type InstallmentRow,
  type PhaseRow,
} from './service';

const isOpen = (r: InstallmentRow) => r.status !== 'paid' && r.paidAmount === 0;

/** Fase gravada no formato do core (para regenerar o cronograma). */
export function phaseFromRow(p: PhaseRow, rows: readonly InstallmentRow[]): DebtPhase {
  const mine = rows
    .filter((r) => r.phaseId === p.id)
    .sort((a, b) => compareDates(a.dueDate, b.dueDate));
  switch (p.system) {
    case 'fixed':
      return {
        system: 'fixed',
        firstDueDate: p.startDate,
        installments: p.installments ?? mine.length,
        ...(p.installmentAmount !== null
          ? { amount: p.installmentAmount }
          : { total: mine.reduce((s, r) => s + r.amount, 0) }),
        startsAfterCompletion: p.startsAfterCompletion,
      };
    case 'price':
    case 'sac':
      return {
        system: p.system,
        principal: p.principal ?? 0,
        monthlyRate: p.rateMonthly,
        installments: p.installments ?? mine.length,
        firstDueDate: p.startDate,
        startsAfterCompletion: p.startsAfterCompletion,
      };
    case 'variable': {
      const informed = mine.filter((r) => !r.estimated);
      const values = (informed.length ? informed : mine.slice(0, 1)).map((r) => ({
        month: r.dueDate.slice(0, 7),
        amount: r.amount,
      }));
      return {
        system: 'variable',
        firstDueDate: p.startDate,
        values,
        endsAtCompletion: p.endsAtCompletion,
        ...(p.endDate ? { lastMonth: p.endDate.slice(0, 7) } : {}),
      };
    }
    case 'balloon':
      return {
        system: 'balloon',
        payments: mine.map((r) => ({ dueDate: r.dueDate, amount: r.amount })),
      };
  }
}

/** Numeração 1..N pela ordem de vencimento. */
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

/**
 * Imóvel na planta: data de entrega, valores mensais da fase variável e correção por
 * índice.
 * @see RN 6.2, 6.7
 */
export function debtPropertyRoutes(
  app: FastifyInstance,
  { db, today }: SpaceContext,
  detail: (spaceId: string, id: string) => Promise<unknown>,
) {
  /**
   * Muda a entrega das chaves: as fases que terminam na entrega (juros de obra) ou começam
   * depois dela (financiamento) têm as parcelas pendentes refeitas; o que foi pago fica.
   */
  app.patch('/debts/:id/completion-date', async (request) => {
    const { spaceId, id } = spaceItemParamsSchema.parse(request.params);
    const { completionDate } = completionDateBodySchema.parse(request.body ?? {});
    const userId = currentUser(request).id;
    await db.transaction(async (tx) => {
      const debt = await findDebt(tx, spaceId, id);
      if (debt.status !== 'active')
        throw badRequest('debt_not_active', 'Esta dívida não está ativa.');
      const [phases, rows] = await Promise.all([
        phasesOf(tx, debt.id),
        installmentsOf(tx, debt.id),
      ]);
      const schedule = scheduleOf(
        phases.map((p) => phaseFromRow(p, rows)),
        completionDate,
      );
      for (const [i, p] of phases.entries()) {
        if (!p.endsAtCompletion && !p.startsAfterCompletion) continue;
        const mine = rows.filter((r) => r.phaseId === p.id);
        const kept = mine.filter((r) => !isOpen(r));
        const fresh = schedule.filter((r) => r.phase === i).slice(kept.length);
        const open = mine.filter(isOpen);
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
        if (fresh.length) {
          await tx.insert(debtInstallments).values(
            fresh.map((r) => ({
              spaceId,
              createdBy: userId,
              debtId: debt.id,
              phaseId: p.id,
              number: 100000 + r.number,
              dueDate: r.dueDate,
              amount: r.amount,
              principalPart: r.principalPart,
              interestPart: r.interestPart,
              estimated: r.estimated ?? false,
            })),
          );
        }
        const all = schedule.filter((r) => r.phase === i);
        await tx
          .update(debtPhases)
          .set({ installments: all.length, startDate: all[0]?.dueDate ?? p.startDate })
          .where(eq(debtPhases.id, p.id));
      }
      await tx.update(debts).set({ completionDate }).where(eq(debts.id, debt.id));
      await tx.insert(debtEvents).values({
        spaceId,
        debtId: debt.id,
        type: 'completion_date_change',
        date: today(),
        createdBy: userId,
        data: { from: debt.completionDate, to: completionDate },
      });
      await renumber(tx, debt.id);
      await syncPlannedEntries(tx, { ...debt, completionDate }, today(), userId);
    });
    return detail(spaceId, id);
  });

  /**
   * Valor real de um mês da fase variável (juros de obra). Os meses seguintes ainda sem
   * valor passam a usar este como estimativa.
   */
  app.post('/debts/:id/phases/:phaseId/values', async (request) => {
    const { spaceId, id, phaseId } = debtPhaseParamsSchema.parse(request.params);
    const { month, amount } = phaseValueBodySchema.parse(request.body ?? {});
    const userId = currentUser(request).id;
    await db.transaction(async (tx) => {
      const debt = await findDebt(tx, spaceId, id);
      const phase = (await phasesOf(tx, debt.id)).find((p) => p.id === phaseId);
      if (!phase) throw notFound('Fase');
      if (phase.system !== 'variable') {
        throw badRequest('not_variable', 'Só fases de valor variável recebem valor por mês.');
      }
      const mine = (await installmentsOf(tx, debt.id))
        .filter((r) => r.phaseId === phase.id)
        .sort((a, b) => compareDates(a.dueDate, b.dueDate));
      const target = mine.find((r) => r.dueDate.slice(0, 7) === month);
      if (!target) throw badRequest('invalid_month', 'Esse mês não faz parte da fase.');
      if (target.status === 'paid')
        throw badRequest('already_paid', 'A parcela desse mês já foi paga.');
      await tx
        .update(debtInstallments)
        .set({ amount, interestPart: amount, principalPart: 0, estimated: false })
        .where(eq(debtInstallments.id, target.id));
      const later = mine.filter(
        (r) => compareDates(r.dueDate, target.dueDate) > 0 && r.estimated && isOpen(r),
      );
      if (later.length) {
        await tx
          .update(debtInstallments)
          .set({ amount, interestPart: amount, principalPart: 0 })
          .where(
            inArray(
              debtInstallments.id,
              later.map((r) => r.id),
            ),
          );
      }
      await syncPlannedEntries(tx, debt, today(), userId);
    });
    return detail(spaceId, id);
  });

  /**
   * Corrige pelo índice do mês as parcelas pendentes da fase que vencem a partir dele
   * (parcelas pagas não mudam). O índice precisa estar cadastrado em `/index-values`.
   */
  app.post('/debts/:id/phases/:phaseId/index', async (request) => {
    const { spaceId, id, phaseId } = debtPhaseParamsSchema.parse(request.params);
    const { month } = applyIndexBodySchema.parse(request.body ?? {});
    const userId = currentUser(request).id;
    await db.transaction(async (tx) => {
      const debt = await findDebt(tx, spaceId, id);
      const phase = (await phasesOf(tx, debt.id)).find((p) => p.id === phaseId);
      if (!phase) throw notFound('Fase');
      if (phase.index === 'none')
        throw badRequest('no_index', 'Esta fase não tem índice de correção.');
      const [value] = await tx
        .select()
        .from(indexValues)
        .where(and(eq(indexValues.index, phase.index), eq(indexValues.month, month)));
      if (!value) {
        throw badRequest(
          'index_value_missing',
          `Cadastre o ${phase.index.toUpperCase()} de ${month} antes.`,
        );
      }
      const events = await tx
        .select()
        .from(debtEvents)
        .where(and(eq(debtEvents.debtId, debt.id), eq(debtEvents.type, 'index_correction')));
      if (events.some((e) => e.data?.phaseId === phase.id && e.data?.month === month)) {
        throw badRequest('index_already_applied', 'O índice desse mês já foi aplicado nesta fase.');
      }
      const from: ISODate = `${month}-01`;
      const pending = (await installmentsOf(tx, debt.id))
        .filter((r) => r.phaseId === phase.id && isOpen(r) && compareDates(r.dueDate, from) >= 0)
        .sort((a, b) => compareDates(a.dueDate, b.dueDate));
      if (!pending.length)
        throw badRequest('nothing_to_correct', 'Não há parcelas pendentes a corrigir.');
      const corrected = applyIndexCorrection(
        pending.map((r, k) => ({
          number: k + 1,
          dueDate: r.dueDate,
          amount: r.amount,
          principalPart: r.principalPart,
          interestPart: r.interestPart,
          balanceAfter: 0,
        })),
        value.value,
      );
      for (const [k, r] of corrected.entries()) {
        const row = pending[k] as InstallmentRow;
        await tx
          .update(debtInstallments)
          .set({ amount: r.amount, principalPart: r.principalPart, interestPart: r.interestPart })
          .where(eq(debtInstallments.id, row.id));
      }
      const before = pending.reduce((s, r) => s + r.amount, 0);
      const after = corrected.reduce((s, r) => s + r.amount, 0);
      await tx.insert(debtEvents).values({
        spaceId,
        debtId: debt.id,
        type: 'index_correction',
        amount: after - before,
        date: today(),
        createdBy: userId,
        data: {
          phaseId: phase.id,
          index: phase.index,
          month,
          value: value.value,
          installments: pending.length,
        },
      });
      await syncPlannedEntries(tx, debt, today(), userId);
    });
    return detail(spaceId, id);
  });
}

/** Índices mensais (globais): listar e cadastrar. @see RN 6.2 */
export function indexValueRoutes(app: FastifyInstance, { db }: SpaceContext) {
  app.get('/index-values', async () => {
    const rows = await db.select().from(indexValues).orderBy(desc(indexValues.month)).limit(120);
    return {
      items: rows.map((r) => ({ index: r.index, month: r.month, value: r.value })),
    };
  });

  app.post('/index-values', async (request, reply) => {
    const body = indexValueBodySchema.parse(request.body ?? {});
    await db
      .insert(indexValues)
      .values({ ...body, createdBy: currentUser(request).id })
      .onConflictDoUpdate({
        target: [indexValues.index, indexValues.month],
        set: { value: body.value },
      });
    return reply.code(201).send(body);
  });
}
