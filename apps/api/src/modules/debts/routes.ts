import {
  debtBodySchema,
  spaceItemParamsSchema,
  updateDebtBodySchema,
  type Debt,
  type DebtDetail,
  type DebtPreview,
} from '@finapp/shared';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { compareDates } from '@finapp/core';
import { debts, transactions } from '../../db/schema';
import { badRequest } from '../../http/errors';
import { currentUser } from '../../plugins/auth';
import { accountForEntry } from '../accounts/service';
import { cardForEntry } from '../cards/service';
import { systemCategoryId } from '../categories/routes';
import { spaceIdOf, type SpaceContext } from '../spaces/scope';
import { assertContact } from '../transactions/service';
import { debtActionRoutes } from './actions';
import { debtPropertyRoutes, indexValueRoutes } from './property';
import {
  findDebt,
  insertDebt,
  installmentsOf,
  phasesOf,
  scheduleOf,
  summaryOf,
  syncPlannedEntries,
  toCorePhase,
  toInstallmentDtos,
  type DebtRow,
} from './service';

/**
 * Dívidas e empréstimos: prévia, cadastro (todos os sistemas e fases), painel e
 * cronograma.
 * @see docs/api.md › Dívidas, RN 6
 */
export function debtRoutes(app: FastifyInstance, { db, today }: SpaceContext) {
  const toDebt = async (debt: DebtRow): Promise<Debt> => {
    const t = today();
    const rows = await installmentsOf(db, debt.id);
    const summary = summaryOf(rows, t);
    const dtos = toInstallmentDtos(rows, t);
    return {
      id: debt.id,
      name: debt.name,
      direction: debt.direction,
      kind: debt.kind,
      contactId: debt.contactId,
      institution: debt.institution,
      principal: debt.principal,
      paymentAccountId: debt.paymentAccountId,
      paymentCardId: debt.paymentCardId,
      completionDate: debt.completionDate,
      completionDeadline: debt.completionDeadline,
      completionConfirmed: debt.completionConfirmed,
      assetValue: debt.assetValue,
      equity: debt.assetValue !== null ? debt.assetValue - summary.outstandingPrincipal : null,
      status: debt.status,
      notes: debt.notes,
      summary,
      next: debt.status === 'active' ? (dtos.find((d) => d.status !== 'paid') ?? null) : null,
    };
  };

  const detail = async (spaceId: string, id: string): Promise<DebtDetail> => {
    const debt = await findDebt(db, spaceId, id);
    const t = today();
    const [base, phases, rows] = await Promise.all([
      toDebt(debt),
      phasesOf(db, debt.id),
      installmentsOf(db, debt.id),
    ]);
    return {
      ...base,
      phases: phases.map((p) => ({
        id: p.id,
        position: p.position,
        name: p.name,
        system: p.system,
        principal: p.principal,
        rateMonthly: p.rateMonthly,
        index: p.index,
        installments: p.installments,
        startDate: p.startDate,
        endDate: p.endDate,
        endsAtCompletion: p.endsAtCompletion,
        startsAfterCompletion: p.startsAfterCompletion,
        summary: summaryOf(
          rows.filter((r) => r.phaseId === p.id),
          t,
        ),
      })),
      installments: toInstallmentDtos(rows, t),
    };
  };

  debtActionRoutes(app, { db, today }, detail);
  debtPropertyRoutes(app, { db, today }, detail);
  indexValueRoutes(app, { db, today });

  /** Cronograma e painel sem gravar. */
  app.post('/debts/preview', async (request): Promise<DebtPreview> => {
    spaceIdOf(request);
    const body = debtBodySchema.parse(request.body ?? {});
    const rows = scheduleOf(body.phases.map(toCorePhase), body.completionDate);
    const summary = summaryOf(
      rows.map((r) => ({
        dueDate: r.dueDate,
        amount: r.amount,
        principalPart: r.principalPart,
        interestPart: r.interestPart,
        paidAmount: r.number <= body.paidInstallments ? r.amount : 0,
        status: r.number <= body.paidInstallments ? ('paid' as const) : ('pending' as const),
      })),
      today(),
    );
    return {
      rows: rows.map((r) => ({
        number: r.number,
        phase: r.phase,
        phaseNumber: r.phaseNumber,
        dueDate: r.dueDate,
        amount: r.amount,
        principalPart: r.principalPart,
        interestPart: r.interestPart,
        balanceAfter: r.balanceAfter,
        estimated: r.estimated ?? false,
      })),
      summary,
    };
  });

  app.post('/debts', async (request, reply) => {
    const spaceId = spaceIdOf(request);
    const body = debtBodySchema.parse(request.body ?? {});
    const userId = currentUser(request).id;
    const t = today();
    const rows = scheduleOf(body.phases.map(toCorePhase), body.completionDate);
    if (body.paidInstallments > rows.length) {
      throw badRequest('invalid_debt', 'Mais parcelas pagas do que parcelas no cronograma.');
    }
    const id = await db.transaction(async (tx) => {
      if (body.paymentAccountId) await accountForEntry(tx, spaceId, body.paymentAccountId, t);
      if (body.paymentCardId) await cardForEntry(tx, spaceId, body.paymentCardId);
      if (body.contactId) await assertContact(tx, spaceId, body.contactId);
      const debt = await insertDebt(tx, spaceId, userId, body, rows);
      if (body.moneyAccountId && debt.principal > 0) {
        // Dinheiro que entrou (devo) ou saiu (me devem): não é renda nem gasto (RN 6.6).
        const date = body.moneyDate ?? t;
        if (compareDates(date, t) > 0) {
          throw badRequest('settled_in_future', 'A data do dinheiro não pode ser futura.');
        }
        await accountForEntry(tx, spaceId, body.moneyAccountId, date);
        const owedToMe = debt.direction === 'owed_to_me';
        await tx.insert(transactions).values({
          spaceId,
          createdBy: userId,
          type: owedToMe ? 'expense' : 'income',
          status: 'settled',
          amount: debt.principal,
          date,
          description: owedToMe
            ? `Empréstimo concedido: ${debt.name}`
            : `Empréstimo recebido: ${debt.name}`,
          accountId: body.moneyAccountId,
          categoryId: await systemCategoryId(tx, spaceId, 'loan'),
          settledAt: new Date(),
        });
      }
      await syncPlannedEntries(tx, debt, t, userId);
      return debt.id;
    });
    return reply.code(201).send(await detail(spaceId, id));
  });

  app.get('/debts', async (request) => {
    const spaceId = spaceIdOf(request);
    const rows = await db
      .select()
      .from(debts)
      .where(and(eq(debts.spaceId, spaceId), isNull(debts.deletedAt)))
      .orderBy(desc(debts.createdAt));
    return { items: await Promise.all(rows.map(toDebt)) };
  });

  app.get('/debts/:id', async (request) => {
    const { spaceId, id } = spaceItemParamsSchema.parse(request.params);
    return detail(spaceId, id);
  });

  /** Dados cadastrais (nome, contato, instituição, valor do bem, observações). */
  app.patch('/debts/:id', async (request) => {
    const { spaceId, id } = spaceItemParamsSchema.parse(request.params);
    const body = updateDebtBodySchema.parse(request.body ?? {});
    await findDebt(db, spaceId, id);
    if (body.contactId) await assertContact(db, spaceId, body.contactId);
    await db.update(debts).set(body).where(eq(debts.id, id));
    return detail(spaceId, id);
  });

  /**
   * Cancela a dívida (cadastro errado ou acordo desfeito): some dos totais e os previstos
   * das parcelas não pagas são apagados. Pagamentos feitos continuam no histórico.
   */
  app.delete('/debts/:id', async (request, reply) => {
    const { spaceId, id } = spaceItemParamsSchema.parse(request.params);
    const debt = await findDebt(db, spaceId, id);
    const rows = await installmentsOf(db, debt.id);
    await db.transaction(async (tx) => {
      await tx.update(debts).set({ status: 'cancelled' }).where(eq(debts.id, debt.id));
      if (rows.length) {
        await tx
          .update(transactions)
          .set({ deletedAt: new Date() })
          .where(
            and(
              inArray(
                transactions.debtInstallmentId,
                rows.map((r) => r.id),
              ),
              eq(transactions.status, 'planned'),
              isNull(transactions.deletedAt),
            ),
          );
      }
    });
    return reply.code(204).send();
  });
}
