import {
  addYearMonths,
  budgetProgress,
  rolloverCarry,
  type BudgetMonth,
  type BudgetProgress,
  type YearMonth,
} from '@finapp/core';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { budgets, categories, invoices, transactions } from '../../db/schema';

/** Quantos meses para trás a sobra acumulada olha. */
const ROLLOVER_MONTHS = 12;

type BudgetRow = typeof budgets.$inferSelect;

/** Despesas efetivadas por mês de competência e categoria (subcategoria soma na mãe). */
export async function spentByMonth(
  db: Db,
  spaceId: string,
  from: YearMonth,
  to: YearMonth,
): Promise<Map<string, Map<string, number>>> {
  // Competência: cartão pela fatura, conta pela data. Estorno no cartão abate o gasto.
  const competence = sql<string>`coalesce(${invoices.referenceMonth}, substr(${transactions.date}::text, 1, 7))`;
  const rows = await db
    .select({
      month: competence,
      categoryId: sql<string>`coalesce(${categories.parentId}, ${categories.id})`,
      amount: sql<string>`sum(case when ${transactions.type} = 'expense' then ${transactions.amount} else -${transactions.amount} end)`,
    })
    .from(transactions)
    .innerJoin(categories, eq(categories.id, transactions.categoryId))
    .leftJoin(invoices, eq(invoices.id, transactions.invoiceId))
    .where(
      and(
        eq(transactions.spaceId, spaceId),
        isNull(transactions.deletedAt),
        eq(transactions.status, 'settled'),
        eq(categories.isSystem, false),
        eq(categories.kind, 'expense'),
        sql`(${transactions.type} = 'expense' or (${transactions.type} = 'income' and ${transactions.invoiceId} is not null))`,
        sql`${competence} between ${from} and ${to}`,
      ),
    )
    .groupBy(competence, sql`coalesce(${categories.parentId}, ${categories.id})`);
  const byMonth = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const m = byMonth.get(r.month) ?? new Map<string, number>();
    m.set(r.categoryId, Number(r.amount));
    byMonth.set(r.month, m);
  }
  return byMonth;
}

/** Orçamento vigente da categoria no mês: o do mês, senão o geral. */
export function effectiveBudget(rows: readonly BudgetRow[], categoryId: string, month: string) {
  const mine = rows.filter((b) => b.categoryId === categoryId);
  return mine.find((b) => b.month === month) ?? mine.find((b) => b.month === null) ?? null;
}

export interface BudgetStatus {
  budget: BudgetRow;
  progress: BudgetProgress;
}

/** Situação de todos os orçamentos do espaço num mês (com sobra acumulada). */
export async function budgetStatuses(
  db: Db,
  spaceId: string,
  month: YearMonth,
): Promise<BudgetStatus[]> {
  const rows = await db
    .select()
    .from(budgets)
    .where(and(eq(budgets.spaceId, spaceId), isNull(budgets.deletedAt)));
  if (!rows.length) return [];
  const first = addYearMonths(month, -ROLLOVER_MONTHS);
  const spent = await spentByMonth(db, spaceId, first, month);

  const categoryIds = [...new Set(rows.map((b) => b.categoryId))];
  const result: BudgetStatus[] = [];
  for (const categoryId of categoryIds) {
    const budget = effectiveBudget(rows, categoryId, month);
    if (!budget) continue;
    const spentOf = (m: string) => spent.get(m)?.get(categoryId) ?? 0;
    let carry = 0;
    if (budget.rollover) {
      // Só conta meses a partir de quando o orçamento geral foi criado.
      const since = budget.createdAt.toISOString().slice(0, 7);
      const history: BudgetMonth[] = [];
      for (let i = ROLLOVER_MONTHS; i >= 1; i--) {
        const m = addYearMonths(month, -i);
        if (m < since) continue;
        const past = effectiveBudget(rows, categoryId, m);
        if (!past) continue;
        history.push({ limit: past.amount, spent: spentOf(m) });
      }
      carry = rolloverCarry(history);
    }
    result.push({
      budget,
      progress: budgetProgress({ limit: budget.amount, spent: spentOf(month) }, carry),
    });
  }
  return result;
}
