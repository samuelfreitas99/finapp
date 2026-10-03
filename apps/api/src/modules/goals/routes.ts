import { goalProgress } from '@finapp/core';
import {
  createGoalBodySchema,
  goalDepositBodySchema,
  spaceItemParamsSchema,
  updateGoalBodySchema,
  type Goal,
} from '@finapp/shared';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../../db/client';
import { accounts, goals } from '../../db/schema';
import { badRequest, notFound } from '../../http/errors';
import { currentUser } from '../../plugins/auth';
import { balancesFor, findAccount } from '../accounts/service';
import { spaceIdOf, type SpaceContext } from '../spaces/scope';

type GoalRow = typeof goals.$inferSelect;

async function toGoals(db: Db, spaceId: string, rows: GoalRow[], today: string): Promise<Goal[]> {
  const accountIds = [...new Set(rows.flatMap((r) => (r.accountId ? [r.accountId] : [])))];
  const accountRows = accountIds.length
    ? await db
        .select()
        .from(accounts)
        .where(and(eq(accounts.spaceId, spaceId), inArray(accounts.id, accountIds)))
    : [];
  const balances = await balancesFor(db, spaceId, accountRows, today, today);
  const nameOf = new Map(accountRows.map((a) => [a.id, a.name]));
  return rows.map((r) => {
    const saved = r.accountId ? (balances.get(r.accountId)?.current ?? 0) : r.savedAmountManual;
    return {
      id: r.id,
      name: r.name,
      targetAmount: r.targetAmount,
      targetDate: r.targetDate,
      accountId: r.accountId,
      accountName: r.accountId ? (nameOf.get(r.accountId) ?? null) : null,
      archived: r.archivedAt !== null,
      ...goalProgress({
        targetAmount: r.targetAmount,
        saved,
        targetDate: r.targetDate,
        today,
      }),
    };
  });
}

/** Metas de poupança com aporte mensal sugerido. @see RN 8 */
export function goalRoutes(app: FastifyInstance, { db, today }: SpaceContext) {
  const find = async (spaceId: string, id: string) => {
    const [row] = await db
      .select()
      .from(goals)
      .where(and(eq(goals.id, id), eq(goals.spaceId, spaceId), isNull(goals.deletedAt)));
    if (!row) throw notFound('Meta');
    return row;
  };
  const one = async (spaceId: string, row: GoalRow) => {
    const [goal] = await toGoals(db, spaceId, [row], today());
    if (!goal) throw new Error('falha ao montar meta');
    return goal;
  };

  app.get('/goals', async (request) => {
    const spaceId = spaceIdOf(request);
    const rows = await db
      .select()
      .from(goals)
      .where(and(eq(goals.spaceId, spaceId), isNull(goals.deletedAt)))
      .orderBy(sql`${goals.archivedAt} asc nulls first`, asc(goals.targetDate), asc(goals.name));
    return { items: await toGoals(db, spaceId, rows, today()) };
  });

  app.post('/goals', async (request, reply) => {
    const spaceId = spaceIdOf(request);
    const body = createGoalBodySchema.parse(request.body ?? {});
    if (body.accountId) await findAccount(db, spaceId, body.accountId);
    const [row] = await db
      .insert(goals)
      .values({
        spaceId,
        name: body.name,
        targetAmount: body.targetAmount,
        targetDate: body.targetDate ?? null,
        accountId: body.accountId ?? null,
        savedAmountManual: body.accountId ? 0 : body.savedAmount,
        createdBy: currentUser(request).id,
      })
      .returning();
    if (!row) throw new Error('falha ao criar meta');
    return reply.code(201).send(await one(spaceId, row));
  });

  app.patch('/goals/:id', async (request) => {
    const { spaceId, id } = spaceItemParamsSchema.parse(request.params);
    const body = updateGoalBodySchema.parse(request.body ?? {});
    const current = await find(spaceId, id);
    if (body.accountId) await findAccount(db, spaceId, body.accountId);
    const set: Partial<typeof goals.$inferInsert> = {};
    if (body.name !== undefined) set.name = body.name;
    if (body.targetAmount !== undefined) set.targetAmount = body.targetAmount;
    if (body.targetDate !== undefined) set.targetDate = body.targetDate;
    if (body.accountId !== undefined) set.accountId = body.accountId;
    if (body.archived !== undefined) set.archivedAt = body.archived ? new Date() : null;
    if (Object.keys(set).length === 0) return one(spaceId, current);
    const [row] = await db.update(goals).set(set).where(eq(goals.id, id)).returning();
    if (!row) throw new Error('falha ao atualizar meta');
    return one(spaceId, row);
  });

  /** Aporte ou retirada marcada à mão (metas sem conta vinculada). */
  app.post('/goals/:id/deposit', async (request) => {
    const { spaceId, id } = spaceItemParamsSchema.parse(request.params);
    const body = goalDepositBodySchema.parse(request.body ?? {});
    const current = await find(spaceId, id);
    if (current.accountId) {
      throw badRequest(
        'goal_linked_to_account',
        'Esta meta usa o saldo de uma conta: faça uma transferência para ela.',
      );
    }
    if (current.savedAmountManual + body.amount < 0) {
      throw badRequest('goal_negative', 'A retirada é maior que o valor guardado.');
    }
    const [row] = await db
      .update(goals)
      .set({ savedAmountManual: sql`${goals.savedAmountManual} + ${body.amount}` })
      .where(eq(goals.id, id))
      .returning();
    if (!row) throw new Error('falha ao registrar aporte');
    return one(spaceId, row);
  });

  app.delete('/goals/:id', async (request, reply) => {
    const { spaceId, id } = spaceItemParamsSchema.parse(request.params);
    await find(spaceId, id);
    await db.update(goals).set({ deletedAt: new Date() }).where(eq(goals.id, id));
    return reply.code(204).send();
  });
}
