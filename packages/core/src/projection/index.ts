import { assertCents, type Cents } from '../money';
import { addYearMonths, diffYearMonths, yearMonthOf, type ISODate, type YearMonth } from '../dates';

/**
 * Projeção do fluxo de caixa mês a mês.
 * @see RN 7
 */

/**
 * Tipo do lançamento previsto. Valores positivos; o tipo define o sinal. Exceção:
 * `invoice` pode ser negativo (estornos maiores que as compras), virando crédito.
 * - `income`: receitas previstas (recorrências, avulsas, parcelas a receber)
 * - `fixed_expense`: despesas fixas em conta (recorrências)
 * - `invoice`: total da fatura, no mês do vencimento
 * - `debt`: parcela de dívida paga por conta
 * - `other_expense`: demais despesas previstas em conta
 */
export type ProjectionKind = 'income' | 'fixed_expense' | 'invoice' | 'debt' | 'other_expense';

export interface ProjectionEntry {
  date: ISODate;
  amount: Cents;
  kind: ProjectionKind;
}

export interface ProjectionMonth {
  month: YearMonth;
  openingBalance: Cents;
  income: Cents;
  fixedExpenses: Cents;
  invoices: Cents;
  debts: Cents;
  otherExpenses: Cents;
  /** Faturas + dívidas + fixas. */
  committed: Cents;
  /** Receitas − comprometido. */
  free: Cents;
  closingBalance: Cents;
  negative: boolean;
}

export interface ProjectionInput {
  /** Saldo atual somado das contas incluídas nos totais. */
  startingBalance: Cents;
  /** Primeiro mês (normalmente o mês corrente). */
  startMonth: YearMonth;
  /** Quantidade de meses (1–36). Padrão 12. */
  months?: number;
  /** Só lançamentos **previstos** (os efetivados já estão no saldo atual). */
  entries: readonly ProjectionEntry[];
}

/**
 * Projeção mês a mês: `saldo_final = saldo_inicial + receitas − despesas`, encadeando
 * os meses. Despesas previstas já vencidas (antes do primeiro mês) entram no primeiro
 * mês, porque ainda vão sair da conta; receitas vencidas não confirmadas ficam de fora
 * (conservador).
 * @see RN 7
 */
export function projectCashFlow({
  startingBalance,
  startMonth,
  months = 12,
  entries,
}: ProjectionInput): ProjectionMonth[] {
  assertCents(startingBalance, 'saldo inicial');
  if (!Number.isInteger(months) || months < 1 || months > 36) {
    throw new RangeError(`months deve estar entre 1 e 36: ${months}`);
  }
  const buckets = Array.from({ length: months }, () => ({
    income: 0,
    fixedExpenses: 0,
    invoices: 0,
    debts: 0,
    otherExpenses: 0,
  }));
  for (const e of entries) {
    assertCents(e.amount, 'valor');
    if (e.amount < 0 && e.kind !== 'invoice') {
      throw new RangeError('valores da projeção devem ser positivos (exceto fatura com crédito)');
    }
    let idx = diffYearMonths(startMonth, yearMonthOf(e.date));
    if (idx >= months) continue;
    if (idx < 0) {
      if (e.kind === 'income') continue;
      idx = 0;
    }
    const b = buckets[idx] as (typeof buckets)[number];
    switch (e.kind) {
      case 'income':
        b.income += e.amount;
        break;
      case 'fixed_expense':
        b.fixedExpenses += e.amount;
        break;
      case 'invoice':
        b.invoices += e.amount;
        break;
      case 'debt':
        b.debts += e.amount;
        break;
      case 'other_expense':
        b.otherExpenses += e.amount;
        break;
    }
  }
  let balance = startingBalance;
  return buckets.map((b, i) => {
    const committed = b.invoices + b.debts + b.fixedExpenses;
    const closingBalance = balance + b.income - committed - b.otherExpenses;
    const month: ProjectionMonth = {
      month: addYearMonths(startMonth, i),
      openingBalance: balance,
      ...b,
      committed,
      free: b.income - committed,
      closingBalance,
      negative: closingBalance < 0,
    };
    balance = closingBalance;
    return month;
  });
}
