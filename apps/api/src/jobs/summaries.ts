import {
  addDays,
  buildSummary,
  endOfMonth,
  isoWeekKey,
  monthName,
  parseISODate,
  weekdayOf,
  yearMonthOf,
  addYearMonths,
  type ISODate,
} from '@finapp/core';
import { and, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import {
  accounts,
  categories,
  creditCards,
  notificationSettings,
  notifications,
  transactions,
} from '../db/schema';
import { cardLedger } from '../modules/cards/service';
import { userSpaces } from '../modules/spaces/access';

interface Totals {
  income: number;
  expense: number;
  /** Despesa por categoria (a categoria-mãe soma as subcategorias). */
  byCategory: Map<string, number>;
}

/** Receitas e despesas efetivadas de um espaço numa faixa de datas (sem categorias técnicas). */
async function periodTotals(db: Db, spaceId: string, from: ISODate, to: ISODate): Promise<Totals> {
  const group = sql<string | null>`coalesce(${categories.parentId}, ${categories.id})::text`;
  const rows = await db
    .select({
      type: transactions.type,
      categoryId: group,
      amount: sql<string>`sum(${transactions.amount})`,
    })
    .from(transactions)
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .where(
      and(
        eq(transactions.spaceId, spaceId),
        isNull(transactions.deletedAt),
        eq(transactions.status, 'settled'),
        inArray(transactions.type, ['income', 'expense']),
        gte(transactions.date, from),
        lte(transactions.date, to),
        sql`(${categories.id} is null or ${categories.isSystem} = false)`,
      ),
    )
    .groupBy(transactions.type, group);
  const ids = [...new Set(rows.flatMap((r) => (r.categoryId ? [r.categoryId] : [])))];
  const names = new Map(
    (ids.length
      ? await db
          .select({ id: categories.id, name: categories.name })
          .from(categories)
          .where(inArray(categories.id, ids))
      : []
    ).map((c) => [c.id, c.name]),
  );
  const totals: Totals = { income: 0, expense: 0, byCategory: new Map() };
  for (const r of rows) {
    const amount = Number(r.amount);
    if (r.type === 'income') totals.income += amount;
    else {
      totals.expense += amount;
      const name = (r.categoryId ? names.get(r.categoryId) : null) ?? 'Sem categoria';
      totals.byCategory.set(name, (totals.byCategory.get(name) ?? 0) + amount);
    }
  }
  return totals;
}

/** Vencimentos entre `from` e `to`: despesas previstas em conta e faturas a pagar. */
async function upcomingDues(db: Db, spaceId: string, from: ISODate, to: ISODate) {
  const accountRows = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(
      and(eq(accounts.spaceId, spaceId), isNull(accounts.deletedAt), isNull(accounts.archivedAt)),
    );
  let count = 0;
  let total = 0;
  if (accountRows.length) {
    const [row] = await db
      .select({
        n: sql<string>`count(*)`,
        total: sql<string>`coalesce(sum(${transactions.amount}), 0)`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.spaceId, spaceId),
          isNull(transactions.deletedAt),
          eq(transactions.status, 'planned'),
          eq(transactions.type, 'expense'),
          inArray(
            transactions.accountId,
            accountRows.map((a) => a.id),
          ),
          gte(transactions.date, from),
          lte(transactions.date, to),
        ),
      );
    count += Number(row?.n ?? 0);
    total += Number(row?.total ?? 0);
  }
  const cards = await db
    .select()
    .from(creditCards)
    .where(
      and(
        eq(creditCards.spaceId, spaceId),
        isNull(creditCards.deletedAt),
        isNull(creditCards.archivedAt),
      ),
    );
  for (const card of cards) {
    const ledger = await cardLedger(db, card, from);
    for (const r of ledger.rows) {
      if (r.remaining > 0 && r.dueDate >= from && r.dueDate <= to) {
        count++;
        total += r.remaining;
      }
    }
  }
  return { count, total };
}

const sum = (list: Totals[]): Totals => {
  const out: Totals = { income: 0, expense: 0, byCategory: new Map() };
  for (const t of list) {
    out.income += t.income;
    out.expense += t.expense;
    for (const [k, v] of t.byCategory) out.byCategory.set(k, (out.byCategory.get(k) ?? 0) + v);
  }
  return out;
};

const top = (t: Totals) =>
  [...t.byCategory]
    .map(([name, amount]) => ({ name, amount }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 3);

const dateBR = (d: ISODate) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

/**
 * Resumos por push, para quem ligou o aviso: toda segunda-feira o da semana que passou
 * (com o que vence nos próximos 7 dias) e todo dia 1º o do mês anterior. Cada resumo reúne
 * todos os espaços do usuário e sai uma vez por período (chave `tipo:período`).
 */
export async function generateSummaries(db: Db, today: ISODate): Promise<number> {
  const weekly = weekdayOf(today) === 1;
  const monthly = parseISODate(today).day === 1;
  if (!weekly && !monthly) return 0;

  const wanted = [
    ...(weekly ? ['weekly_summary' as const] : []),
    ...(monthly ? ['monthly_summary' as const] : []),
  ];
  const subs = await db
    .select({ userId: notificationSettings.userId, type: notificationSettings.type })
    .from(notificationSettings)
    .where(and(inArray(notificationSettings.type, wanted), eq(notificationSettings.enabled, true)));

  let created = 0;
  for (const { userId, type } of subs) {
    const mine = await userSpaces(db, userId);
    if (mine.length === 0) continue;
    let summary;
    let dedupeKey: string;
    if (type === 'weekly_summary') {
      const from = addDays(today, -7);
      const to = addDays(today, -1);
      const [now, before, dues] = await Promise.all([
        Promise.all(mine.map((s) => periodTotals(db, s.id, from, to))).then(sum),
        Promise.all(
          mine.map((s) => periodTotals(db, s.id, addDays(from, -7), addDays(from, -1))),
        ).then(sum),
        Promise.all(mine.map((s) => upcomingDues(db, s.id, today, addDays(today, 6)))),
      ]);
      summary = buildSummary({
        kind: 'weekly',
        periodLabel: `${dateBR(from)} a ${dateBR(to)}`,
        income: now.income,
        expense: now.expense,
        previousExpense: before.expense,
        topCategories: top(now),
        upcoming: {
          count: dues.reduce((a, d) => a + d.count, 0),
          total: dues.reduce((a, d) => a + d.total, 0),
        },
      });
      dedupeKey = `${userId}:weekly_summary:${isoWeekKey(today)}`;
    } else {
      const month = addYearMonths(yearMonthOf(today), -1);
      const prev = addYearMonths(month, -1);
      const range = (ym: string) => ({ from: `${ym}-01` as ISODate, to: endOfMonth(`${ym}-01`) });
      const [now, before] = await Promise.all([
        Promise.all(
          mine.map((s) => periodTotals(db, s.id, range(month).from, range(month).to)),
        ).then(sum),
        Promise.all(mine.map((s) => periodTotals(db, s.id, range(prev).from, range(prev).to))).then(
          sum,
        ),
      ]);
      summary = buildSummary({
        kind: 'monthly',
        periodLabel: monthName(month),
        income: now.income,
        expense: now.expense,
        previousExpense: before.expense,
        topCategories: top(now),
      });
      dedupeKey = `${userId}:monthly_summary:${month}`;
    }
    const inserted = await db
      .insert(notifications)
      .values({
        userId,
        type,
        title: summary.title,
        body: summary.body,
        url: summary.url,
        entityType: 'space',
        entityId: null,
        dedupeKey,
      })
      .onConflictDoNothing()
      .returning({ id: notifications.id });
    created += inserted.length;
  }
  return created;
}
