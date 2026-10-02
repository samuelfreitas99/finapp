import {
  addYearMonths,
  availableLimit,
  invoiceDates,
  invoiceForPurchase,
  invoiceLedger,
  yearMonthOf,
  type CardConfig,
  type InvoiceLedgerRow,
  type InvoiceOverrides,
  type ISODate,
  type YearMonth,
} from '@finapp/core';
import type { InvoiceSummary } from '@finapp/shared';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { creditCards, invoicePayments, invoices, transactions } from '../../db/schema';
import type { DbExecutor } from '../../db/seed';
import { badRequest, notFound } from '../../http/errors';

export type CardRow = typeof creditCards.$inferSelect;
export type InvoiceRow = typeof invoices.$inferSelect;

/** Cartão do espaço (não apagado), ou 404. */
export async function findCard(db: DbExecutor, spaceId: string, id: string) {
  const [row] = await db
    .select()
    .from(creditCards)
    .where(
      and(eq(creditCards.id, id), eq(creditCards.spaceId, spaceId), isNull(creditCards.deletedAt)),
    );
  if (!row) throw notFound('Cartão');
  return row;
}

/** Cartão que recebe uma compra nova: não arquivado. */
export async function cardForEntry(db: DbExecutor, spaceId: string, id: string) {
  const card = await findCard(db, spaceId, id);
  if (card.archivedAt) throw badRequest('card_archived', `O cartão "${card.name}" está arquivado.`);
  return card;
}

export const cardConfig = (card: CardRow): CardConfig => ({
  closingDay: card.closingDay,
  dueDay: card.dueDay,
  closingDayGoesToNext: card.closingDayGoesToNext,
});

async function invoiceRows(db: DbExecutor, cardId: string) {
  return db
    .select()
    .from(invoices)
    .where(and(eq(invoices.cardId, cardId), isNull(invoices.deletedAt)));
}

function overridesOf(rows: readonly InvoiceRow[]): InvoiceOverrides {
  const map = new Map(rows.map((r) => [r.referenceMonth, r]));
  return (ym) => {
    const r = map.get(ym);
    return r ? { closingDate: r.closingDateOverride, dueDate: r.dueDateOverride } : undefined;
  };
}

/** Mês da fatura em que cai uma compra (ou estorno) nesta data, com os overrides. */
export async function invoiceMonthFor(db: DbExecutor, card: CardRow, date: ISODate) {
  return invoiceForPurchase(cardConfig(card), date, overridesOf(await invoiceRows(db, card.id)));
}

/** Fatura do mês, criada na hora se ainda não existe. */
export async function ensureInvoice(
  db: DbExecutor,
  card: CardRow,
  referenceMonth: YearMonth,
  createdBy: string | null,
): Promise<InvoiceRow> {
  const existing = await invoiceRows(db, card.id);
  const found = existing.find((r) => r.referenceMonth === referenceMonth);
  if (found) return found;
  const dates = invoiceDates(cardConfig(card), referenceMonth, overridesOf(existing));
  await db
    .insert(invoices)
    .values({
      spaceId: card.spaceId,
      cardId: card.id,
      referenceMonth,
      closingDate: dates.closingDate,
      dueDate: dates.dueDate,
      createdBy,
    })
    .onConflictDoNothing();
  const [row] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.cardId, card.id), eq(invoices.referenceMonth, referenceMonth)));
  if (!row) throw new Error('falha ao criar fatura');
  return row;
}

/** Itens da fatura somados com sinal: compra soma, estorno (receita) subtrai. */
const signedItem = sql<string>`sum(case when ${transactions.type} = 'income' then -${transactions.amount} else ${transactions.amount} end)`;

export interface CardLedger {
  /** Uma linha por mês do intervalo, inclusive meses sem fatura gravada. */
  rows: (InvoiceLedgerRow & { invoice: InvoiceRow | null })[];
  availableLimit: number;
  currentMonth: YearMonth;
}

/**
 * Faturas do cartão encadeadas (saldo anterior, total, status) e limite disponível.
 * Inclui todos os meses entre a primeira fatura e `max(último, mês atual + 1, to)`.
 * Atualiza `invoices.status` quando o estado calculado muda.
 */
export async function cardLedger(
  db: DbExecutor,
  card: CardRow,
  today: ISODate,
  { to }: { to?: YearMonth | undefined } = {},
): Promise<CardLedger> {
  const rows = await invoiceRows(db, card.id);
  const overrides = overridesOf(rows);
  const config = cardConfig(card);
  const currentMonth = invoiceForPurchase(config, today, overrides);
  const ids = rows.map((r) => r.id);
  const [itemSums, paymentSums, [totals]] = await Promise.all([
    ids.length
      ? db
          .select({ invoiceId: transactions.invoiceId, total: signedItem })
          .from(transactions)
          .where(and(inArray(transactions.invoiceId, ids), isNull(transactions.deletedAt)))
          .groupBy(transactions.invoiceId)
      : [],
    ids.length
      ? db
          .select({
            invoiceId: invoicePayments.invoiceId,
            total: sql<string>`sum(${invoicePayments.amount})`,
          })
          .from(invoicePayments)
          .where(and(inArray(invoicePayments.invoiceId, ids), isNull(invoicePayments.deletedAt)))
          .groupBy(invoicePayments.invoiceId)
      : [],
    db
      .select({ items: signedItem })
      .from(transactions)
      .where(and(eq(transactions.cardId, card.id), isNull(transactions.deletedAt))),
  ]);
  const items = new Map(itemSums.map((s) => [s.invoiceId, Number(s.total)]));
  const paid = new Map(paymentSums.map((s) => [s.invoiceId, Number(s.total)]));
  const byMonth = new Map(rows.map((r) => [r.referenceMonth, r]));

  const months = rows.map((r) => r.referenceMonth).sort();
  const first = months[0] && months[0] < currentMonth ? months[0] : currentMonth;
  let last = addYearMonths(currentMonth, 1);
  for (const m of [months.at(-1), to]) if (m && m > last) last = m;

  const input = [];
  for (let m = first; m <= last; m = addYearMonths(m, 1)) {
    const row = byMonth.get(m);
    const dates = row ?? invoiceDates(config, m, overrides);
    input.push({
      referenceMonth: m,
      closingDate: dates.closingDate,
      dueDate: dates.dueDate,
      items: row ? (items.get(row.id) ?? 0) : 0,
      paid: row ? (paid.get(row.id) ?? 0) : 0,
    });
  }
  const ledger = invoiceLedger(input, today).map((r) => ({
    ...r,
    invoice: byMonth.get(r.referenceMonth) ?? null,
  }));

  const stale = ledger.filter((r) => r.invoice && r.invoice.status !== r.status);
  for (const r of stale) {
    if (r.invoice) {
      await db.update(invoices).set({ status: r.status }).where(eq(invoices.id, r.invoice.id));
    }
  }

  const allPaid = [...paid.values()].reduce((a, b) => a + b, 0);
  return {
    rows: ledger,
    currentMonth,
    availableLimit: availableLimit({
      limit: card.limitAmount,
      unpaidItems: Number(totals?.items ?? 0),
      payments: allPaid,
    }),
  };
}

export function toInvoiceSummary(row: CardLedger['rows'][number]): InvoiceSummary {
  return {
    referenceMonth: row.referenceMonth,
    closingDate: row.closingDate,
    dueDate: row.dueDate,
    closingDateOverride: row.invoice?.closingDateOverride ?? null,
    dueDateOverride: row.invoice?.dueDateOverride ?? null,
    status: row.status,
    items: row.items,
    carried: row.carried,
    total: row.total,
    paid: row.paid,
    remaining: row.remaining,
  };
}

export { yearMonthOf };
