import { addDays, endOfMonth, isPastDue, monthFlow, yearMonthOf, type ISODate } from '@finapp/core';
import { dashboardQuerySchema, type Dashboard } from '@finapp/shared';
import { and, asc, eq, gte, isNotNull, isNull, lt, lte, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../../db/client';
import { accounts, categories, transactions } from '../../db/schema';
import { balancesFor } from '../accounts/service';
import { spaceIdOf, type SpaceContext } from '../spaces/scope';
import { tagsOf, toTransaction } from '../transactions/service';

const UPCOMING_DAYS = 7;
const UPCOMING_LIMIT = 10;

/** Retrato do espaço no mês: saldo, previsto, receitas x despesas e próximos vencimentos. */
export async function buildDashboard(
  db: Db,
  spaceId: string,
  month: string,
  t: ISODate,
): Promise<Dashboard> {
  const from = `${month}-01`;
  const forecastDate = endOfMonth(from);

  const live = and(eq(transactions.spaceId, spaceId), isNull(transactions.deletedAt));
  const [rows, sums, upcomingRows, pastRows] = await Promise.all([
    db
      .select()
      .from(accounts)
      .where(
        and(eq(accounts.spaceId, spaceId), isNull(accounts.deletedAt), isNull(accounts.archivedAt)),
      ),
    db
      .select({
        type: transactions.type,
        status: transactions.status,
        amount: sql<string>`sum(${transactions.amount})`,
      })
      .from(transactions)
      // Categorias técnicas (pagamento de fatura, ajuste, transferência, empréstimo) não
      // são receita nem gasto: a compra no cartão já conta, o dinheiro emprestado não é renda.
      .leftJoin(categories, eq(categories.id, transactions.categoryId))
      .where(
        and(
          live,
          gte(transactions.date, from),
          lte(transactions.date, forecastDate),
          or(isNull(categories.id), eq(categories.isSystem, false)),
        ),
      )
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
      .select({ date: transactions.date })
      .from(transactions)
      .where(and(live, eq(transactions.status, 'planned'), lt(transactions.date, t))),
  ]);

  const [imported] = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(and(eq(transactions.spaceId, spaceId), isNotNull(transactions.importKey)))
    .limit(1);
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
    // Vencido em fim de semana/feriado ainda pode ser pago no dia útil seguinte.
    overdueCount: pastRows.filter((r) => isPastDue(r.date, t)).length,
    hasAccounts: rows.length > 0,
    hasImports: Boolean(imported),
  };
}

/** Início: saldo, previsto no fim do mês, receitas x despesas e próximos vencimentos. */
export function dashboardRoutes(app: FastifyInstance, { db, today }: SpaceContext) {
  app.get('/dashboard', async (request): Promise<Dashboard> => {
    const spaceId = spaceIdOf(request);
    const query = dashboardQuerySchema.parse(request.query);
    const t = today();
    return buildDashboard(db, spaceId, query.month ?? yearMonthOf(t), t);
  });
}
