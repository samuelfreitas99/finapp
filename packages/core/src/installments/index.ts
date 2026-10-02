import { assertCents, splitCents, type Cents } from '../money';
import {
  addMonths,
  addYearMonths,
  businessDayAdjust,
  diffYearMonths,
  parseISODate,
  type BusinessDayAdjust,
  type HolidaySet,
  type ISODate,
  type YearMonth,
} from '../dates';
import {
  invoiceForPurchase,
  type CardConfig,
  type InvoiceOverrides,
  type InvoiceStatus,
} from '../cards';

/**
 * Compras parceladas: no cartão (uma parcela por fatura) ou fora dele (carnê/boleto).
 * @see RN 5
 */

export interface Installment {
  /** 1..N */
  number: number;
  amount: Cents;
  /** No cartão: data da compra + (k−1) meses, só para ordenação. Fora: vencimento. */
  date: ISODate;
  /** Mês de vencimento da fatura (só no cartão). */
  invoiceMonth?: YearMonth;
}

interface BasePlanInput {
  /** Total da compra. Informe este **ou** `installmentAmount`. */
  totalAmount?: Cents;
  /** Valor da parcela; total = parcela × N. */
  installmentAmount?: Cents;
  installments: number;
  /** Plano já em andamento: gera só as parcelas `startInstallment..N`. Padrão 1. */
  startInstallment?: number;
}

export interface CardPlanInput extends BasePlanInput {
  card: CardConfig;
  /** Data da compra. */
  firstDate: ISODate;
  /**
   * Para plano em andamento (`startInstallment > 1`): a data de hoje. A parcela
   * `startInstallment` vai na fatura em que cai essa data.
   */
  currentDate?: ISODate;
  overrides?: InvoiceOverrides;
}

export interface AccountPlanInput extends BasePlanInput {
  /** Vencimento da 1ª parcela. */
  firstDueDate: ISODate;
  adjust?: BusinessDayAdjust;
  holidays?: HolidaySet;
}

function resolveTotal(input: BasePlanInput): Cents {
  const { totalAmount, installmentAmount, installments } = input;
  if (!Number.isSafeInteger(installments) || installments < 1) {
    throw new RangeError(`installments deve ser inteiro >= 1: ${installments}`);
  }
  if ((totalAmount === undefined) === (installmentAmount === undefined)) {
    throw new RangeError('informe totalAmount ou installmentAmount (só um)');
  }
  if (totalAmount !== undefined) {
    assertCents(totalAmount, 'total');
    return totalAmount;
  }
  assertCents(installmentAmount, 'parcela');
  return (installmentAmount as Cents) * installments;
}

function resolveStart(input: BasePlanInput): number {
  const start = input.startInstallment ?? 1;
  if (!Number.isInteger(start) || start < 1 || start > input.installments) {
    throw new RangeError(`startInstallment deve estar entre 1 e ${input.installments}: ${start}`);
  }
  return start;
}

/**
 * Parcelas de uma compra no cartão. A parcela 1 cai na fatura da data da compra e a
 * parcela k, k−1 meses depois. Valores pela RN 5.1 (resto na 1ª).
 * Plano em andamento: a parcela `startInstallment` cai na fatura atual (`currentDate`).
 * @see RN 5.1, 5.2, 5.3
 */
export function cardInstallments(input: CardPlanInput): Installment[] {
  const total = resolveTotal(input);
  const start = resolveStart(input);
  const amounts = splitCents(total, input.installments);
  const anchor = parseISODate(input.firstDate).day;
  let baseMonth: YearMonth;
  if (start === 1) {
    baseMonth = invoiceForPurchase(input.card, input.firstDate, input.overrides);
  } else {
    if (!input.currentDate) throw new RangeError('plano em andamento exige currentDate');
    baseMonth = invoiceForPurchase(input.card, input.currentDate, input.overrides);
  }
  const result: Installment[] = [];
  for (let k = start; k <= input.installments; k++) {
    result.push({
      number: k,
      amount: amounts[k - 1] as Cents,
      date: addMonths(input.firstDate, k - 1, anchor),
      invoiceMonth: addYearMonths(baseMonth, k - start),
    });
  }
  return result;
}

/**
 * Parcelas fora do cartão (carnê/boleto): parcela k vence em `firstDueDate + (k−1)`
 * meses, com clamp e ajuste de dia útil opcional.
 * @see RN 5.2, 5.3
 */
export function accountInstallments(input: AccountPlanInput): Installment[] {
  const total = resolveTotal(input);
  const start = resolveStart(input);
  const amounts = splitCents(total, input.installments);
  const anchor = parseISODate(input.firstDueDate).day;
  const adjust = input.adjust ?? 'none';
  if (adjust !== 'none' && !input.holidays)
    throw new RangeError('ajuste de dia útil exige holidays');
  const result: Installment[] = [];
  for (let k = start; k <= input.installments; k++) {
    const due = addMonths(input.firstDueDate, k - 1, anchor);
    result.push({
      number: k,
      amount: amounts[k - 1] as Cents,
      date: adjust === 'none' ? due : businessDayAdjust(due, adjust, input.holidays as HolidaySet),
    });
  }
  return result;
}

/** Status da fatura de uma parcela; `future` = fatura que ainda nem abriu. */
export type InstallmentInvoiceStatus = InvoiceStatus | 'future';

export interface PlannedInstallment {
  number: number;
  amount: Cents;
  invoiceMonth: YearMonth;
  invoiceStatus: InstallmentInvoiceStatus;
}

/**
 * Cancelamento/devolução: parcelas em faturas `open` ou `future` são canceladas; as já
 * faturadas (fechadas/pagas) viram estorno na fatura aberta, se o banco devolver.
 * @see RN 5.4
 */
export function cancelPlan(
  installments: readonly PlannedInstallment[],
  { refundBilled }: { refundBilled: boolean },
): { cancel: number[]; refundAmount: Cents } {
  const cancel: number[] = [];
  let refundAmount = 0;
  for (const i of installments) {
    if (i.invoiceStatus === 'open' || i.invoiceStatus === 'future') cancel.push(i.number);
    else if (refundBilled) refundAmount += i.amount;
  }
  return { cancel, refundAmount };
}

export type AnticipationDiscount = { amount: Cents } | { monthlyRate: number };

export interface AnticipationResult {
  /** Parcelas que mudam para a fatura aberta. */
  moved: { number: number; fromMonth: YearMonth; months: number }[];
  /** Desconto total (vira item negativo "Desconto antecipação"). */
  discount: Cents;
}

/**
 * Antecipa as **últimas** `count` parcelas ainda em faturas futuras para a fatura aberta
 * (`openMonth`). Desconto: valor informado, ou taxa mensal `i` com valor presente
 * `parcela / (1+i)^m` (m = meses antecipados). O desconto por taxa é arredondado para
 * baixo, para não prometer economia maior que a real.
 * @see RN 5.5
 */
export function anticipateInstallments(
  installments: readonly PlannedInstallment[],
  count: number,
  openMonth: YearMonth,
  discount?: AnticipationDiscount,
): AnticipationResult {
  const eligible = installments
    .filter((i) => diffYearMonths(openMonth, i.invoiceMonth) > 0)
    .sort((a, b) => a.number - b.number);
  if (!Number.isInteger(count) || count < 1 || count > eligible.length) {
    throw new RangeError(`count deve estar entre 1 e ${eligible.length}: ${count}`);
  }
  const chosen = eligible.slice(-count);
  const moved = chosen.map((i) => ({
    number: i.number,
    fromMonth: i.invoiceMonth,
    months: diffYearMonths(openMonth, i.invoiceMonth),
  }));
  let total = 0;
  if (discount && 'amount' in discount) {
    assertCents(discount.amount, 'desconto');
    total = discount.amount;
  } else if (discount) {
    const rate = discount.monthlyRate;
    if (!(rate >= 0 && rate < 1)) throw new RangeError(`taxa mensal inválida: ${rate}`);
    let exact = 0;
    for (const [idx, i] of chosen.entries()) {
      const m = moved[idx]?.months ?? 0;
      exact += i.amount - i.amount / (1 + rate) ** m;
    }
    total = Math.floor(exact + 1e-9);
  }
  const chosenSum = chosen.reduce((a, i) => a + i.amount, 0);
  if (total < 0 || total > chosenSum) throw new RangeError('desconto fora do intervalo');
  return { moved, discount: total };
}

export interface PlanSummary {
  paidCount: number;
  remainingCount: number;
  paidAmount: Cents;
  remainingAmount: Cents;
  /** 0–1 */
  progressByAmount: number;
  /** 0–1 */
  progressByCount: number;
}

/**
 * Painel do parcelamento, sobre as parcelas existentes do plano (num plano cadastrado
 * em andamento, as parcelas anteriores não existem e não entram na conta).
 * Uma parcela conta como paga quando a fatura dela está `paid`.
 * @see RN 5.6
 */
export function planSummary(
  installments: readonly { amount: Cents; invoiceStatus: InstallmentInvoiceStatus }[],
): PlanSummary {
  let paidCount = 0;
  let paidAmount = 0;
  let total = 0;
  for (const i of installments) {
    assertCents(i.amount, 'parcela');
    total += i.amount;
    if (i.invoiceStatus === 'paid') {
      paidCount++;
      paidAmount += i.amount;
    }
  }
  const count = installments.length;
  return {
    paidCount,
    remainingCount: count - paidCount,
    paidAmount,
    remainingAmount: total - paidAmount,
    progressByAmount: total === 0 ? 0 : paidAmount / total,
    progressByCount: count === 0 ? 0 : paidCount / count,
  };
}
