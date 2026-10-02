import { endOfMonth, type AccountBalance } from '@finapp/core';
import {
  accountBalanceQuerySchema,
  createAccountBodySchema,
  listAccountsQuerySchema,
  spaceItemParamsSchema,
  updateAccountBodySchema,
  type Account,
  type AccountBalanceResponse,
} from '@finapp/shared';
import { and, asc, eq, isNull, lt } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { accounts, spaceMembers, transactions } from '../../db/schema';
import { badRequest, conflict } from '../../http/errors';
import { currentUser } from '../../plugins/auth';
import { spaceIdOf, type SpaceContext } from '../spaces/scope';
import { balancesFor, findAccount, type AccountRow } from './service';

function toAccount(row: AccountRow, balance: AccountBalance, forecastDate: string): Account {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    initialBalance: row.initialBalance,
    initialDate: row.initialDate,
    color: row.color,
    icon: row.icon,
    includeInTotals: row.includeInTotals,
    ownerUserId: row.ownerUserId,
    archived: row.archivedAt !== null,
    balance: balance.current,
    forecastBalance: balance.forecast,
    forecastDate,
  };
}

/** Contas: CRUD e saldo. @see docs/api.md › Cadastros, RN 1 */
export function accountRoutes(app: FastifyInstance, { db, today }: SpaceContext) {
  const assertMember = async (spaceId: string, userId: string | null | undefined) => {
    if (!userId) return;
    const [member] = await db
      .select({ userId: spaceMembers.userId })
      .from(spaceMembers)
      .where(and(eq(spaceMembers.spaceId, spaceId), eq(spaceMembers.userId, userId)));
    if (!member) throw badRequest('invalid_owner', 'O dono da conta precisa ser membro do espaço.');
  };

  const withBalance = async (spaceId: string, row: AccountRow) => {
    const t = today();
    const forecastDate = endOfMonth(t);
    const balance = (await balancesFor(db, spaceId, [row], t, forecastDate)).get(row.id);
    if (!balance) throw new Error('saldo não calculado');
    return toAccount(row, balance, forecastDate);
  };

  app.get('/accounts', async (request) => {
    const spaceId = spaceIdOf(request);
    const query = listAccountsQuerySchema.parse(request.query);
    const rows = await db
      .select()
      .from(accounts)
      .where(
        and(
          eq(accounts.spaceId, spaceId),
          isNull(accounts.deletedAt),
          query.includeArchived ? undefined : isNull(accounts.archivedAt),
        ),
      )
      .orderBy(asc(accounts.createdAt));
    const t = today();
    const forecastDate = query.forecastDate ?? endOfMonth(t);
    const balances = await balancesFor(db, spaceId, rows, t, forecastDate);
    return {
      items: rows.map((r) =>
        toAccount(r, balances.get(r.id) ?? { current: 0, forecast: 0 }, forecastDate),
      ),
    };
  });

  app.get('/accounts/:id', async (request) => {
    const { spaceId, id } = spaceItemParamsSchema.parse(request.params);
    return withBalance(spaceId, await findAccount(db, spaceId, id));
  });

  app.get('/accounts/:id/balance', async (request): Promise<AccountBalanceResponse> => {
    const { spaceId, id } = spaceItemParamsSchema.parse(request.params);
    const { date } = accountBalanceQuerySchema.parse(request.query);
    const row = await findAccount(db, spaceId, id);
    const t = today();
    const target = date ?? t;
    const balance = (await balancesFor(db, spaceId, [row], t, target)).get(row.id);
    if (!balance) throw new Error('saldo não calculado');
    return {
      accountId: row.id,
      today: t,
      current: balance.current,
      date: target,
      forecast: balance.forecast,
    };
  });

  app.post('/accounts', async (request, reply) => {
    const spaceId = spaceIdOf(request);
    const user = currentUser(request);
    const body = createAccountBodySchema.parse(request.body ?? {});
    await assertMember(spaceId, body.ownerUserId);
    const [row] = await db
      .insert(accounts)
      .values({
        spaceId,
        createdBy: user.id,
        name: body.name,
        type: body.type,
        initialBalance: body.initialBalance,
        initialDate: body.initialDate,
        color: body.color ?? null,
        icon: body.icon ?? null,
        includeInTotals: body.includeInTotals,
        ownerUserId: body.ownerUserId ?? null,
      })
      .returning();
    if (!row) throw new Error('falha ao criar conta');
    return reply.code(201).send(await withBalance(spaceId, row));
  });

  app.patch('/accounts/:id', async (request) => {
    const { spaceId, id } = spaceItemParamsSchema.parse(request.params);
    const body = updateAccountBodySchema.parse(request.body ?? {});
    const current = await findAccount(db, spaceId, id);
    if (body.ownerUserId !== undefined) await assertMember(spaceId, body.ownerUserId);
    if (body.initialDate !== undefined && body.initialDate > current.initialDate) {
      const [earlier] = await db
        .select({ id: transactions.id })
        .from(transactions)
        .where(
          and(
            eq(transactions.accountId, id),
            isNull(transactions.deletedAt),
            lt(transactions.date, body.initialDate),
          ),
        )
        .limit(1);
      if (earlier) {
        throw conflict(
          'transactions_before_initial_date',
          'Há lançamentos antes da nova data do saldo inicial.',
        );
      }
    }
    const { archived, ...fields } = body;
    const [row] = await db
      .update(accounts)
      .set({
        ...fields,
        ...(archived === undefined
          ? {}
          : { archivedAt: archived ? (current.archivedAt ?? new Date()) : null }),
      })
      .where(eq(accounts.id, id))
      .returning();
    if (!row) throw new Error('falha ao atualizar conta');
    return withBalance(spaceId, row);
  });

  app.delete('/accounts/:id', async (request, reply) => {
    const { spaceId, id } = spaceItemParamsSchema.parse(request.params);
    await findAccount(db, spaceId, id);
    const [used] = await db
      .select({ id: transactions.id })
      .from(transactions)
      .where(and(eq(transactions.accountId, id), isNull(transactions.deletedAt)))
      .limit(1);
    if (used) {
      throw conflict(
        'account_has_transactions',
        'A conta tem lançamentos: arquive em vez de excluir.',
      );
    }
    await db.update(accounts).set({ deletedAt: new Date() }).where(eq(accounts.id, id));
    return reply.code(204).send();
  });
}
