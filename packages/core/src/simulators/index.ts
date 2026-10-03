import { pricePayment } from '../debts';
import type { Cents } from '../money';

/**
 * Simuladores ("e se eu comprar em Nx?"): oferta parcelada, taxa embutida, à vista x
 * parcelado e impacto no saldo previsto. Funções puras; nada é gravado.
 */

export interface InstallmentOffer {
  installments: number;
  installmentAmount: Cents;
  /** `installmentAmount × installments` (a última parcela real pode ajustar centavos). */
  total: Cents;
  /** O que se paga a mais que o preço à vista. */
  interest: Cents;
  /** Taxa de juros mensal embutida (0 = sem juros). */
  monthlyRate: number;
}

/**
 * Valor presente de uma série de `n` parcelas postecipadas à taxa `i`: `pmt·(1−(1+i)^−n)/i`.
 */
function annuityFactor(i: number, n: number): number {
  return i === 0 ? n : (1 - (1 + i) ** -n) / i;
}

/**
 * Taxa mensal embutida num parcelamento: acha `i` tal que `preço = parcela·(1−(1+i)^−n)/i`
 * (bisseção, precisão de 1e-10). Parcela que soma menos que o preço devolve 0.
 */
export function impliedMonthlyRate(price: Cents, installmentAmount: Cents, n: number): number {
  if (!Number.isInteger(n) || n < 1) throw new RangeError('parcelas inválidas');
  if (price <= 0 || installmentAmount <= 0) throw new RangeError('valores devem ser > 0');
  if (installmentAmount * n <= price) return 0;
  let low = 0;
  let high = 1;
  for (let k = 0; k < 100; k++) {
    const mid = (low + high) / 2;
    // Com taxa maior, o valor presente das parcelas cai: queremos igualar ao preço.
    if (installmentAmount * annuityFactor(mid, n) > price) low = mid;
    else high = mid;
  }
  return Math.round(((low + high) / 2) * 1e8) / 1e8;
}

/** Oferta a partir do preço e da taxa mensal (Price) ou do valor da parcela. */
export function installmentOffer(input: {
  price: Cents;
  installments: number;
  monthlyRate?: number;
  installmentAmount?: Cents;
}): InstallmentOffer {
  const { price, installments: n } = input;
  if (!Number.isInteger(price) || price <= 0) throw new RangeError('preço deve ser > 0');
  if (!Number.isInteger(n) || n < 1 || n > 420) throw new RangeError('parcelas inválidas');
  const hasRate = input.monthlyRate !== undefined;
  const hasAmount = input.installmentAmount !== undefined;
  if (hasRate === hasAmount) throw new RangeError('informe a taxa ou o valor da parcela');
  const installmentAmount = hasAmount
    ? (input.installmentAmount as Cents)
    : pricePayment(price, input.monthlyRate as number, n);
  const monthlyRate = hasRate
    ? (input.monthlyRate as number)
    : impliedMonthlyRate(price, installmentAmount, n);
  const total = installmentAmount * n;
  return {
    installments: n,
    installmentAmount,
    total,
    interest: Math.max(0, total - price),
    monthlyRate,
  };
}

export interface CashVsInstallments {
  /** Valor presente das parcelas na taxa de oportunidade. */
  presentValue: Cents;
  cashPrice: Cents;
  /** `parcelado − à vista` em valor presente; negativo = parcelar sai mais barato. */
  difference: Cents;
  cheaper: 'cash' | 'installments' | 'tie';
  /** Desconto à vista mínimo (sobre o preço parcelado) para o à vista compensar. */
  breakEvenDiscount: number;
}

/**
 * À vista x parcelado: compara o preço à vista com o valor presente das parcelas, trazido
 * pela taxa mensal que o dinheiro rende (oportunidade). Parcelas pagas no fim de cada mês.
 */
export function cashVsInstallments(input: {
  cashPrice: Cents;
  installmentAmount: Cents;
  installments: number;
  opportunityRate: number;
}): CashVsInstallments {
  const { cashPrice, installmentAmount, installments: n, opportunityRate: i } = input;
  if (!(i >= 0 && i < 1)) throw new RangeError('taxa de oportunidade inválida');
  const presentValue = Math.round(installmentAmount * annuityFactor(i, n));
  const difference = presentValue - cashPrice;
  const nominal = installmentAmount * n;
  return {
    presentValue,
    cashPrice,
    difference,
    cheaper: difference === 0 ? 'tie' : difference > 0 ? 'cash' : 'installments',
    breakEvenDiscount: nominal > 0 ? Math.max(0, 1 - presentValue / nominal) : 0,
  };
}

export interface ForecastMonth {
  month: string;
  closingBalance: Cents;
}

export interface BalanceImpact {
  months: { month: string; before: Cents; after: Cents; outflow: Cents }[];
  lowest: { month: string; balance: Cents } | null;
  /** Primeiro mês em que o saldo fica negativo com a compra (e não ficava antes). */
  firstNewNegative: string | null;
}

/**
 * Impacto de novas saídas no saldo previsto: cada saída reduz o saldo do mês e de todos os
 * seguintes (o saldo final do mês é acumulado).
 */
export function balanceImpact(
  forecast: readonly ForecastMonth[],
  outflows: readonly { month: string; amount: Cents }[],
): BalanceImpact {
  const perMonth = new Map<string, number>();
  for (const o of outflows) perMonth.set(o.month, (perMonth.get(o.month) ?? 0) + o.amount);
  let cumulative = 0;
  const months = forecast.map((f) => {
    const outflow = perMonth.get(f.month) ?? 0;
    cumulative += outflow;
    return {
      month: f.month,
      before: f.closingBalance,
      after: f.closingBalance - cumulative,
      outflow,
    };
  });
  const lowestRow = months.reduce<(typeof months)[number] | null>(
    (low, m) => (low === null || m.after < low.after ? m : low),
    null,
  );
  return {
    months,
    lowest: lowestRow ? { month: lowestRow.month, balance: lowestRow.after } : null,
    firstNewNegative: months.find((m) => m.after < 0 && m.before >= 0)?.month ?? null,
  };
}
