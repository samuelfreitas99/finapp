import {
  addYearMonths,
  endOfMonth,
  projectCashFlow,
  yearMonthOf,
  type ProjectionEntry,
} from '@finapp/core';
import { projectionQuerySchema, type Projection } from '@finapp/shared';
import { and, eq, inArray, isNull, lte } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { accounts, creditCards, transactions } from '../../db/schema';
import { balancesFor } from '../accounts/service';
import { cardLedger } from '../cards/service';
import { spaceIdOf, type SpaceContext } from '../spaces/scope';

/**
 * Projeção do fluxo de caixa mês a mês (RN 7): parte do saldo atual das contas que somam
 * nos totais e soma os previstos dessas contas (receitas, fixas, parcelas de carnê e
 * demais) e o que falta pagar de cada fatura no vencimento. Transferências ficam de fora.
 */
export function projectionRoutes(app: FastifyInstance, { db, today }: SpaceContext) {
  app.get('/projection', async (request): Promise<Projection> => {
    const spaceId = spaceIdOf(request);
    const { months } = projectionQuerySchema.parse(request.query);
    const t = today();
    const startMonth = yearMonthOf(t);
    const lastMonth = addYearMonths(startMonth, months - 1);
    const until = endOfMonth(`${lastMonth}-01`);

    const accountRows = await db
      .select()
      .from(accounts)
      .where(
        and(
          eq(accounts.spaceId, spaceId),
          isNull(accounts.deletedAt),
          isNull(accounts.archivedAt),
          eq(accounts.includeInTotals, true),
        ),
      );
    const balances = await balancesFor(db, spaceId, accountRows, t, t);
    const startingBalance = [...balances.values()].reduce((s, b) => s + b.current, 0);

    const entries: ProjectionEntry[] = [];
    if (accountRows.length) {
      const planned = await db
        .select()
        .from(transactions)
        .where(
          and(
            eq(transactions.spaceId, spaceId),
            isNull(transactions.deletedAt),
            eq(transactions.status, 'planned'),
            inArray(
              transactions.accountId,
              accountRows.map((a) => a.id),
            ),
            inArray(transactions.type, ['income', 'expense']),
            lte(transactions.date, until),
          ),
        );
      for (const p of planned) {
        entries.push({
          date: p.date,
          amount: p.amount,
          kind:
            p.type === 'income'
              ? 'income'
              : p.recurrenceId
                ? 'fixed_expense'
                : p.installmentPlanId || p.debtInstallmentId
                  ? 'debt'
                  : 'other_expense',
        });
      }
    }

    const cards = await db
      .select()
      .from(creditCards)
      .where(and(eq(creditCards.spaceId, spaceId), isNull(creditCards.deletedAt)));
    for (const card of cards) {
      const ledger = await cardLedger(db, card, t, { to: lastMonth });
      for (const row of ledger.rows) {
        if (row.remaining > 0 && row.dueDate <= until) {
          entries.push({ date: row.dueDate, amount: row.remaining, kind: 'invoice' });
        }
      }
    }

    return {
      today: t,
      startingBalance,
      months: projectCashFlow({ startingBalance, startMonth, months, entries }),
    };
  });
}
