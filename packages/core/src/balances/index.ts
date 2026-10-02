import { assertCents, type Cents } from '../money';
import { compareDates, type ISODate } from '../dates';

/**
 * Saldos de conta a partir dos lançamentos.
 * @see RN 1 (Saldos)
 */

export type LedgerType = 'income' | 'expense' | 'transfer_in' | 'transfer_out' | 'adjustment';
export type LedgerStatus = 'planned' | 'settled';

export interface LedgerEntry {
  type: LedgerType;
  status: LedgerStatus;
  /** Positivo; só `adjustment` tem sinal (a diferença, positiva ou negativa). */
  amount: Cents;
  date: ISODate;
}

/** Efeito do lançamento no saldo da conta. */
export function signedAmount(type: LedgerType, amount: Cents): Cents {
  assertCents(amount, 'valor');
  if (type === 'adjustment') {
    if (amount === 0) throw new RangeError('ajuste não pode ser zero');
    return amount;
  }
  if (amount <= 0) throw new RangeError('valor deve ser > 0');
  return type === 'income' || type === 'transfer_in' ? amount : -amount;
}

export interface AccountBalance {
  /** `saldo_inicial + Σ efetivados com data <= hoje`. */
  current: Cents;
  /** `saldo_inicial + Σ efetivados e previstos com data <= forecastDate`. */
  forecast: Cents;
}

/**
 * Saldo atual (até `today`, inclusive, só efetivados) e previsto em `forecastDate`
 * (efetivados e previstos até essa data, inclusive os previstos já vencidos).
 * @see RN 1 (Saldos)
 */
export function accountBalance(
  initialBalance: Cents,
  entries: Iterable<LedgerEntry>,
  today: ISODate,
  forecastDate: ISODate = today,
): AccountBalance {
  assertCents(initialBalance, 'saldo inicial');
  let current = initialBalance;
  let forecast = initialBalance;
  for (const e of entries) {
    const delta = signedAmount(e.type, e.amount);
    if (e.status === 'settled' && compareDates(e.date, today) <= 0) current += delta;
    if (compareDates(e.date, forecastDate) <= 0) forecast += delta;
  }
  assertCents(current, 'saldo atual');
  assertCents(forecast, 'saldo previsto');
  return { current, forecast };
}

/**
 * Valor do ajuste para o saldo efetivado chegar ao saldo real informado
 * (`null` se já bate).
 * @see RN 1 (Ajuste de saldo)
 */
export function adjustmentAmount(currentBalance: Cents, realBalance: Cents): Cents | null {
  assertCents(currentBalance, 'saldo atual');
  assertCents(realBalance, 'saldo real');
  const diff = realBalance - currentBalance;
  return diff === 0 ? null : diff;
}
