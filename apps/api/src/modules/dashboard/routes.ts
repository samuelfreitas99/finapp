import { addDays, endOfMonth, monthFlow, yearMonthOf } from '@finapp/core';
import { dashboardQuerySchema, type Dashboard } from '@finapp/shared';
import { and, asc, count, eq, gte, isNull, lt, lte, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { accounts, transactions } from '../../db/schema';
import { balancesFor } from '../accounts/service';
import { spaceIdOf, type SpaceContext } from '../spaces/scope';
import { tagsOf, toTransaction } from '../transactions/service';

const UPCOMING_DAYS = 7;
const UPCOMING_LIMIT = 10;

/** Início: saldo, previsto no fim do mês, receitas x despesas e próximos vencimentos. */
export function dashboardRoutes(app: FastifyInstance, { db, today }: SpaceContext) {
  app.get('/dashboard', async (request): Promise<Dashboard> => {
    const spaceId = spaceIdOf(request);
    const query = dashboardQuerySchema.parse(request.query);
    const t = today();
    const month = query.month ?? yearMonthOf(t);
    const from = `${month}-01`;
    const forecastDate = endOfMonth(from);

    const live = and(eq(transactions.spaceId, spaceId), isNull(transactions.deletedAt));
    const [rows, sums, upcomingRows, [overdue]] = await Promise.all([
      db
        .select()
        .from(accounts)
        .where(
          and(
            eq(accounts.spaceId, spaceId),
            isNull(accounts.deletedAt),
            isNull(accounts.archivedAt),
          ),
        ),
      db
        .select({
          type: transactions.type,
          status: transactions.status,
          amount: sql<string>`sum(${transactions.amount})`,
        })
        .from(transactions)
        .where(and(live, gte(transactions.date, from), lte(transactions.date, forecastDate)))
        .groupBy(transactions.type, transactions.status),
      db
        .select()
        .from(transactions)
        .where(
          and(
            live,
            eq(transactions.status, 'planned'),
            lte(transactions.date, addDays(t, UPCOMING_DAYS)),
          ),
        )
        .orderBy(asc(transactions.date), asc(transactions.id))
        .limit(UPCOMING_LIMIT),
      db
        .select({ n: count() })
        .from(transactions)
        .where(and(live, eq(transactions.status, 'planned'), lt(transactions.date, t))),
    ]);

    const included = rows.filter((r) => r.includeInTotals);
    const balances = await balancesFor(db, spaceId, included, t, forecastDate);
    let balance = 0;
    let forecastBalance = 0;
    for (const b of balances.values()) {
      balance += b.current;
      forecastBalance += b.forecast;
    }
    const flow = monthFlow(
      sums
        .filter((s) => s.type === 'income' || s.type === 'expense')
        .map((s) => ({ type: s.type, status: s.status, amount: Number(s.amount) })),
    );
    const tagMap = await tagsOf(
      db,
      upcomingRows.map((r) => r.id),
    );

    return {
      today: t,
      month,
      balance,
      forecastBalance,
      forecastDate,
      income: flow.income,
      expense: flow.expense,
      upcoming: upcomingRows.map((r) => toTransaction(r, tagMap.get(r.id) ?? [])),
      overdueCount: overdue?.n ?? 0,
      hasAccounts: rows.length > 0,
    };
  });
}
