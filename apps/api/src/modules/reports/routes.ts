import {
  addYearMonths,
  categoryBreakdown,
  netWorth,
  savingsRate,
  yearMonthOf,
  type NetWorthLine,
} from '@finapp/core';
import {
  byCategoryQuerySchema,
  monthlyQuerySchema,
  type ByCategoryReport,
  type MonthlyReport,
  type NetWorthReport,
} from '@finapp/shared';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { accounts, categories, creditCards, debts } from '../../db/schema';
import { badRequest } from '../../http/errors';
import { balancesFor } from '../accounts/service';
import { NO_CATEGORY, totalsByMonth } from '../budgets/service';
import { cardLedger } from '../cards/service';
import { installmentsOf, summaryOf } from '../debts/service';
import { spaceIdOf, type SpaceContext } from '../spaces/scope';

/** Relatórios: por categoria, mensal e patrimônio. Só lançamentos efetivados. */
export function reportRoutes(app: FastifyInstance, { db, today }: SpaceContext) {
  app.get('/reports/by-category', async (request): Promise<ByCategoryReport> => {
    const spaceId = spaceIdOf(request);
    const query = byCategoryQuerySchema.parse(request.query);
    const current = yearMonthOf(today());
    const from = query.from ?? query.to ?? current;
    const to = query.to ?? current;
    if (from > to) throw badRequest('invalid_range', 'O mês inicial é depois do final.');

    const byMonth = await totalsByMonth(db, spaceId, from, to, query.kind);
    const sums = new Map<string, number>();
    for (const month of byMonth.values()) {
      for (const [id, amount] of month) sums.set(id, (sums.get(id) ?? 0) + amount);
    }
    const ids = [...sums.keys()].filter((id) => id !== NO_CATEGORY);
    const cats = ids.length
      ? await db.select().from(categories).where(inArray(categories.id, ids))
      : [];
    const catOf = new Map(cats.map((c) => [c.id, c]));
    const breakdown = categoryBreakdown(
      [...sums].map(([id, amount]) => ({
        id,
        name: id === NO_CATEGORY ? 'Sem categoria' : (catOf.get(id)?.name ?? 'Categoria'),
        amount,
      })),
      9,
    );
    return {
      from,
      to,
      kind: query.kind,
      total: breakdown.total,
      items: breakdown.items.map((i) => ({
        ...i,
        color: catOf.get(i.id)?.color ?? null,
      })),
    };
  });

  app.get('/reports/monthly', async (request): Promise<MonthlyReport> => {
    const spaceId = spaceIdOf(request);
    const { months } = monthlyQuerySchema.parse(request.query);
    const to = yearMonthOf(today());
    const from = addYearMonths(to, -(months - 1));
    const [expenses, incomes] = await Promise.all([
      totalsByMonth(db, spaceId, from, to, 'expense'),
      totalsByMonth(db, spaceId, from, to, 'income'),
    ]);
    const sum = (m: Map<string, number> | undefined) =>
      m ? [...m.values()].reduce((s, v) => s + v, 0) : 0;
    const items = Array.from({ length: months }, (_, i) => {
      const month = addYearMonths(from, i);
      const income = sum(incomes.get(month));
      const expense = sum(expenses.get(month));
      return {
        month,
        income,
        expense,
        balance: income - expense,
        savingsRate: savingsRate(income, expense),
      };
    });
    const income = items.reduce((s, i) => s + i.income, 0);
    const expense = items.reduce((s, i) => s + i.expense, 0);
    return {
      items,
      totals: {
        income,
        expense,
        balance: income - expense,
        savingsRate: savingsRate(income, expense),
      },
    };
  });

  /**
   * Patrimônio hoje: saldos das contas (positivos), a receber de pessoas e imóveis já
   * entregues; menos faturas em aberto, contas negativas e dívidas (principal ainda não
   * amortizado).
   */
  app.get('/reports/net-worth', async (request): Promise<NetWorthReport> => {
    const spaceId = spaceIdOf(request);
    const t = today();
    const accountRows = await db
      .select()
      .from(accounts)
      .where(
        and(eq(accounts.spaceId, spaceId), isNull(accounts.deletedAt), isNull(accounts.archivedAt)),
      );
    const balances = await balancesFor(db, spaceId, accountRows, t, t);
    let positive = 0;
    let negative = 0;
    for (const b of balances.values()) {
      if (b.current >= 0) positive += b.current;
      else negative += -b.current;
    }

    const cardRows = await db
      .select()
      .from(creditCards)
      .where(
        and(
          eq(creditCards.spaceId, spaceId),
          isNull(creditCards.deletedAt),
          isNull(creditCards.archivedAt),
        ),
      );
    let invoicesOpen = 0;
    for (const card of cardRows) {
      const ledger = await cardLedger(db, card, t);
      invoicesOpen += ledger.rows.reduce((s, r) => s + r.remaining, 0);
    }

    const debtRows = await db
      .select()
      .from(debts)
      .where(and(eq(debts.spaceId, spaceId), isNull(debts.deletedAt), eq(debts.status, 'active')));
    let owe = 0;
    let owed = 0;
    let property = 0;
    for (const d of debtRows) {
      const outstanding = summaryOf(await installmentsOf(db, d.id), t).outstandingPrincipal;
      if (d.direction === 'i_owe') {
        owe += outstanding;
        if (d.assetValue !== null && d.completionConfirmed) property += d.assetValue;
      } else {
        owed += outstanding;
      }
    }

    const assetLines: NetWorthLine[] = [
      { label: 'Contas', amount: positive },
      { label: 'A receber de pessoas', amount: owed },
      { label: 'Imóveis entregues', amount: property },
    ].filter((l) => l.amount > 0);
    const liabilityLines: NetWorthLine[] = [
      { label: 'Faturas de cartão em aberto', amount: invoicesOpen },
      { label: 'Contas no negativo', amount: negative },
      { label: 'Dívidas e financiamentos', amount: owe },
    ].filter((l) => l.amount > 0);
    return { ...netWorth(assetLines, liabilityLines), assetLines, liabilityLines };
  });
}
