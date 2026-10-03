import { assertCents, type Cents } from '../money';
import {
  addDays,
  addYearMonths,
  clampDay,
  compareDates,
  parseYearMonth,
  yearMonthOf,
  type ISODate,
  type YearMonth,
} from '../dates';
import { isPastDue } from '../holidays';

/**
 * Cartão de crédito: datas da fatura, em qual fatura cai uma compra, melhor dia de
 * compra, status e limite disponível.
 * @see RN 4
 */

export interface CardConfig {
  /** Dia do fechamento (1–31, com clamp). */
  closingDay: number;
  /** Dia do vencimento (1–31, com clamp). */
  dueDay: number;
  /** `true` (padrão): compra **no** dia do fechamento já vai para a próxima fatura. */
  closingDayGoesToNext?: boolean;
}

/** Datas alteradas pelo banco numa fatura específica. */
export interface InvoiceOverride {
  closingDate?: ISODate | null;
  dueDate?: ISODate | null;
}

/** Busca os overrides de uma fatura pelo mês de vencimento. */
export type InvoiceOverrides = (referenceMonth: YearMonth) => InvoiceOverride | undefined;

export interface InvoiceDates {
  /** Mês de vencimento (identifica a fatura). */
  referenceMonth: YearMonth;
  closingDate: ISODate;
  dueDate: ISODate;
}

function assertDay(day: number, label: string): void {
  if (!Number.isInteger(day) || day < 1 || day > 31) {
    throw new RangeError(`${label} deve ser inteiro entre 1 e 31: ${day}`);
  }
}

/**
 * Datas da fatura do mês de vencimento `referenceMonth`. O fechamento fica no mesmo mês
 * do vencimento se `dueDay > closingDay`; senão, no mês anterior. Overrides têm prioridade.
 * @see RN 4 (Datas de uma fatura)
 */
export function invoiceDates(
  card: CardConfig,
  referenceMonth: YearMonth,
  overrides?: InvoiceOverrides,
): InvoiceDates {
  assertDay(card.closingDay, 'closingDay');
  assertDay(card.dueDay, 'dueDay');
  const { year, month } = parseYearMonth(referenceMonth);
  const closingYm =
    card.dueDay > card.closingDay ? referenceMonth : addYearMonths(referenceMonth, -1);
  const closing = parseYearMonth(closingYm);
  const override = overrides?.(referenceMonth);
  return {
    referenceMonth,
    closingDate: override?.closingDate ?? clampDay(closing.year, closing.month, card.closingDay),
    dueDate: override?.dueDate ?? clampDay(year, month, card.dueDay),
  };
}

function containsPurchase(card: CardConfig, purchase: ISODate, closingDate: ISODate): boolean {
  const cmp = compareDates(purchase, closingDate);
  return (card.closingDayGoesToNext ?? true) ? cmp < 0 : cmp <= 0;
}

/**
 * Mês de vencimento da fatura em que cai uma compra (ou estorno) feita em `purchase`.
 * Ex.: fechamento 3, vencimento 10: compra 02/10/2026 → `2026-10`; 03/10/2026 → `2026-11`.
 * @see RN 4 (Em qual fatura cai uma compra)
 */
export function invoiceForPurchase(
  card: CardConfig,
  purchase: ISODate,
  overrides?: InvoiceOverrides,
): YearMonth {
  // A fatura certa está entre o mês da compra e dois meses depois (fechamento no mês
  // anterior ao vencimento). Começa um mês antes por causa de overrides.
  let ym = addYearMonths(yearMonthOf(purchase), -1);
  for (let i = 0; i < 4; i++, ym = addYearMonths(ym, 1)) {
    if (containsPurchase(card, purchase, invoiceDates(card, ym, overrides).closingDate)) {
      return ym;
    }
  }
  throw new RangeError(`não foi possível achar a fatura da compra ${purchase}`);
}

/**
 * Período de compras da fatura: `[start, end]` (inclusive).
 * @see RN 4
 */
export function invoicePeriod(
  card: CardConfig,
  referenceMonth: YearMonth,
  overrides?: InvoiceOverrides,
): { start: ISODate; end: ISODate } {
  const goesToNext = card.closingDayGoesToNext ?? true;
  const prev = invoiceDates(card, addYearMonths(referenceMonth, -1), overrides).closingDate;
  const curr = invoiceDates(card, referenceMonth, overrides).closingDate;
  return goesToNext
    ? { start: prev, end: addDays(curr, -1) }
    : { start: addDays(prev, 1), end: curr };
}

/**
 * Melhor dia de compra (dia do mês): o fechamento com a regra `true`, ou o dia
 * seguinte com `false` (31 + 1 vira 1).
 * @see RN 4
 */
export function bestPurchaseDay(card: CardConfig): number {
  assertDay(card.closingDay, 'closingDay');
  if (card.closingDayGoesToNext ?? true) return card.closingDay;
  return card.closingDay === 31 ? 1 : card.closingDay + 1;
}

/**
 * Próxima data (a partir de `today`, inclusive) em que uma compra cai no início de um
 * período de fatura, ou seja, com o maior prazo até o pagamento.
 * @see RN 4
 */
export function nextBestPurchaseDate(
  card: CardConfig,
  today: ISODate,
  overrides?: InvoiceOverrides,
): ISODate {
  const ref = invoiceForPurchase(card, today, overrides);
  const { start } = invoicePeriod(card, ref, overrides);
  if (compareDates(start, today) === 0) return today;
  return invoicePeriod(card, addYearMonths(ref, 1), overrides).start;
}

export type InvoiceStatus = 'open' | 'closed' | 'paid' | 'partial' | 'overdue';

export interface InvoiceStatusInput {
  closingDate: ISODate;
  dueDate: ISODate;
  /** Total da fatura (Σ itens, estornos negativos). */
  total: Cents;
  /** Σ pagamentos registrados. */
  paid: Cents;
  today: ISODate;
}

/**
 * Status da fatura. Antes do fechamento é sempre `open`. Depois: `paid` se os pagamentos
 * cobrem o total; `partial` se houve pagamento menor (o restante vai para a próxima
 * fatura como saldo anterior); `overdue` se venceu sem pagamento; senão `closed`.
 * @see RN 4 (Estados da fatura)
 */
export function invoiceStatus({
  closingDate,
  dueDate,
  total,
  paid,
  today,
}: InvoiceStatusInput): InvoiceStatus {
  assertCents(total, 'total');
  assertCents(paid, 'pago');
  if (compareDates(today, closingDate) < 0) return 'open';
  if (paid >= total) return 'paid';
  if (paid > 0) return 'partial';
  if (isPastDue(dueDate, today)) return 'overdue';
  return 'closed';
}

/**
 * Valor que sobra de um pagamento parcial e vira item "Saldo anterior" na próxima fatura.
 * @see RN 4 (Pagamento parcial)
 */
export function carriedBalance(total: Cents, paid: Cents): Cents {
  assertCents(total, 'total');
  assertCents(paid, 'pago');
  return Math.max(0, total - paid);
}

export interface AvailableLimitInput {
  limit: Cents;
  /**
   * Σ itens de faturas ainda não quitadas (abertas, fechadas e futuras, incluindo
   * parcelas futuras), com estornos negativos.
   */
  unpaidItems: Cents;
  /** Σ pagamentos já feitos nessas faturas. */
  payments: Cents;
}

/**
 * Limite disponível = limite − itens não pagos + pagamentos feitos. Pode ser negativo
 * (limite estourado).
 * @see RN 4 (Limite disponível)
 */
export function availableLimit({ limit, unpaidItems, payments }: AvailableLimitInput): Cents {
  assertCents(limit, 'limite');
  assertCents(unpaidItems, 'itens');
  assertCents(payments, 'pagamentos');
  return limit - unpaidItems + payments;
}

export interface InvoiceLedgerInput {
  referenceMonth: YearMonth;
  closingDate: ISODate;
  dueDate: ISODate;
  /** Σ itens da fatura (compras, parcelas, encargos; estornos negativos). */
  items: Cents;
  /** Σ pagamentos registrados. */
  paid: Cents;
}

export interface InvoiceLedgerRow extends InvoiceLedgerInput {
  /** "Saldo anterior": o que sobrou da fatura do mês anterior após pagamento parcial. */
  carried: Cents;
  /** `carried + items`. */
  total: Cents;
  /** `max(0, total − paid)`. */
  remaining: Cents;
  status: InvoiceStatus;
}

/**
 * Encadeia as faturas de um cartão, mês a mês: o restante de uma fatura `partial` cujo
 * vencimento já passou vira saldo anterior da fatura do mês seguinte (que deixa de ser
 * cobrado na anterior). Fatura vencida sem nenhum pagamento (`overdue`) continua cobrando
 * o total nela mesma. Meses sem fatura no meio da lista recebem o saldo com zero itens.
 * @see RN 4 (Estados da fatura, Pagamento parcial)
 */
export function invoiceLedger(
  invoices: readonly InvoiceLedgerInput[],
  today: ISODate,
): InvoiceLedgerRow[] {
  const sorted = [...invoices].sort((a, b) => a.referenceMonth.localeCompare(b.referenceMonth));
  const result: InvoiceLedgerRow[] = [];
  let carry = 0;
  let carryTo: YearMonth | null = null;
  for (const inv of sorted) {
    assertCents(inv.items, 'itens');
    assertCents(inv.paid, 'pago');
    const carried = carryTo === inv.referenceMonth ? carry : 0;
    const total = carried + inv.items;
    const status = invoiceStatus({ ...inv, total, paid: inv.paid, today });
    const pastDue = compareDates(today, inv.dueDate) > 0;
    const remaining = carriedBalance(total, inv.paid);
    const carries = status === 'partial' && pastDue && remaining > 0;
    result.push({
      ...inv,
      carried,
      total,
      remaining: carries ? 0 : remaining,
      status,
    });
    carry = carries ? remaining : 0;
    carryTo = carries ? addYearMonths(inv.referenceMonth, 1) : null;
  }
  return result;
}
