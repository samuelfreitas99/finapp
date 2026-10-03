import { assertCents, presentValueDiscount, splitCents, type Cents } from '../money';
import {
  addMonths,
  addYearMonths,
  clampDay,
  compareDates,
  diffYearMonths,
  parseISODate,
  parseYearMonth,
  yearMonthOf,
  type ISODate,
  type YearMonth,
} from '../dates';

/**
 * Dívidas e empréstimos: cronogramas por sistema (fixed, price, sac, variable, balloon),
 * correção por índice, amortização extraordinária, quitação, painel e fases do imóvel
 * na planta.
 * @see RN 6
 */

export type DebtSystem = 'fixed' | 'price' | 'sac' | 'variable' | 'balloon';

export interface ScheduleRow {
  /** 1..N dentro da fase (ou da dívida, em `debtSchedule`). */
  number: number;
  dueDate: ISODate;
  amount: Cents;
  principalPart: Cents;
  interestPart: Cents;
  /** Saldo devedor depois desta parcela (price/sac; nos outros, Σ principal restante). */
  balanceAfter: Cents;
  /** Valor estimado (fase `variable` sem valor informado para o mês). */
  estimated?: boolean;
}

/** Arredonda para o centavo, meio para cima, tolerando ruído de ponto flutuante. */
export function roundHalfUp(value: number): number {
  const cleaned = Math.round(value * 1e6) / 1e6;
  return Math.sign(cleaned) * Math.round(Math.abs(cleaned));
}

/**
 * Taxa mensal equivalente a uma taxa anual: `(1 + i_a)^(1/12) − 1`.
 * @see RN 6.1
 */
export function monthlyRateFromAnnual(annualRate: number): number {
  if (!(annualRate > -1)) throw new RangeError(`taxa anual inválida: ${annualRate}`);
  return (1 + annualRate) ** (1 / 12) - 1;
}

function assertRate(rate: number): void {
  if (!(rate >= 0 && rate < 1)) throw new RangeError(`taxa mensal inválida: ${rate}`);
}

function assertCount(n: number, label = 'installments'): void {
  if (!Number.isSafeInteger(n) || n < 1)
    throw new RangeError(`${label} deve ser inteiro >= 1: ${n}`);
}

function dueDates(firstDueDate: ISODate, count: number): ISODate[] {
  const anchor = parseISODate(firstDueDate).day;
  return Array.from({ length: count }, (_, k) => addMonths(firstDueDate, k, anchor));
}

function withBalances(rows: Omit<ScheduleRow, 'balanceAfter'>[]): ScheduleRow[] {
  let remaining = rows.reduce((a, r) => a + r.principalPart, 0);
  return rows.map((r) => {
    remaining -= r.principalPart;
    return { ...r, balanceAfter: remaining };
  });
}

export interface FixedPhaseInput {
  firstDueDate: ISODate;
  installments: number;
  /** Valor de cada parcela. Informe este **ou** `total`. */
  amount?: Cents;
  /** Total dividido pela regra de centavos (resto na 1ª). */
  total?: Cents;
}

/**
 * Sistema `fixed`: N parcelas de valor informado, ou total/N com a regra de 5.1. Sem juros.
 * @see RN 6.1
 */
export function fixedSchedule({
  firstDueDate,
  installments,
  amount,
  total,
}: FixedPhaseInput): ScheduleRow[] {
  assertCount(installments);
  if ((amount === undefined) === (total === undefined)) {
    throw new RangeError('informe amount ou total (só um)');
  }
  let amounts: Cents[];
  if (amount !== undefined) {
    assertCents(amount, 'parcela');
    amounts = Array<Cents>(installments).fill(amount);
  } else {
    amounts = splitCents(total as Cents, installments);
  }
  const dates = dueDates(firstDueDate, installments);
  return withBalances(
    amounts.map((a, i) => ({
      number: i + 1,
      dueDate: dates[i] as ISODate,
      amount: a,
      principalPart: a,
      interestPart: 0,
    })),
  );
}

export interface AmortizedPhaseInput {
  /** Valor financiado (saldo devedor inicial). */
  principal: Cents;
  /** Taxa mensal (ex.: 0.01 = 1% a.m.). */
  monthlyRate: number;
  installments: number;
  firstDueDate: ISODate;
}

/**
 * Parcela constante do sistema Price: `PMT = PV·i / (1 − (1+i)^−n)`, arredondada ao centavo.
 * @see RN 6.1
 */
export function pricePayment(principal: Cents, monthlyRate: number, installments: number): Cents {
  assertCents(principal, 'principal');
  assertRate(monthlyRate);
  assertCount(installments);
  if (monthlyRate === 0) return Math.ceil(principal / installments);
  return roundHalfUp((principal * monthlyRate) / (1 - (1 + monthlyRate) ** -installments));
}

/** Cronograma com parcela fixa `payment` até zerar o saldo; a última ajusta. */
function scheduleWithPayment(
  principal: Cents,
  monthlyRate: number,
  payment: Cents,
  firstDueDate: ISODate,
  maxInstallments: number,
): ScheduleRow[] {
  const anchor = parseISODate(firstDueDate).day;
  const rows: ScheduleRow[] = [];
  let balance = principal;
  for (let k = 1; balance > 0; k++) {
    if (k > maxInstallments)
      throw new RangeError('a parcela não é suficiente para quitar a dívida');
    const interest = roundHalfUp(balance * monthlyRate);
    let principalPart = payment - interest;
    if (principalPart <= 0 && k < maxInstallments) {
      throw new RangeError('a parcela não cobre os juros');
    }
    if (k === maxInstallments || principalPart >= balance) principalPart = balance;
    balance -= principalPart;
    rows.push({
      number: k,
      dueDate: addMonths(firstDueDate, k - 1, anchor),
      amount: principalPart + interest,
      principalPart,
      interestPart: interest,
      balanceAfter: balance,
    });
  }
  return rows;
}

/**
 * Sistema `price`: parcela constante; juros = saldo·i (meio para cima), amortização =
 * PMT − juros; a última parcela ajusta para zerar o saldo.
 * @see RN 6.1
 */
export function priceSchedule({
  principal,
  monthlyRate,
  installments,
  firstDueDate,
}: AmortizedPhaseInput): ScheduleRow[] {
  const payment = pricePayment(principal, monthlyRate, installments);
  return scheduleWithPayment(principal, monthlyRate, payment, firstDueDate, installments);
}

/** Sistema SAC com amortização `amortization` por parcela até zerar o saldo. */
function sacWithAmortization(
  principal: Cents,
  monthlyRate: number,
  amortizations: Cents[],
  firstDueDate: ISODate,
): ScheduleRow[] {
  const dates = dueDates(firstDueDate, amortizations.length);
  let balance = principal;
  return amortizations.map((a, i) => {
    const interest = roundHalfUp(balance * monthlyRate);
    balance -= a;
    return {
      number: i + 1,
      dueDate: dates[i] as ISODate,
      amount: a + interest,
      principalPart: a,
      interestPart: interest,
      balanceAfter: balance,
    };
  });
}

/**
 * Sistema `sac`: amortização constante PV/n (resto de centavos na 1ª, RN 5.1);
 * juros = saldo·i; parcela = amortização + juros.
 * @see RN 6.1
 */
export function sacSchedule({
  principal,
  monthlyRate,
  installments,
  firstDueDate,
}: AmortizedPhaseInput): ScheduleRow[] {
  assertCents(principal, 'principal');
  assertRate(monthlyRate);
  assertCount(installments);
  return sacWithAmortization(
    principal,
    monthlyRate,
    splitCents(principal, installments),
    firstDueDate,
  );
}

export interface VariablePhaseInput {
  firstDueDate: ISODate;
  /** Último mês da fase (inclusive). Em imóvel na planta: mês da entrega. */
  lastMonth: YearMonth;
  /** Valores informados por mês (juros de obra). */
  values: readonly { month: YearMonth; amount: Cents }[];
}

/**
 * Sistema `variable`: valor informado mês a mês. Meses sem valor usam o último valor
 * informado antes deles, marcados como estimativa. Antes do primeiro valor informado,
 * usa o primeiro valor (também estimado). Os valores são juros (sem amortização).
 * @see RN 6.1
 */
export function variableSchedule({
  firstDueDate,
  lastMonth,
  values,
}: VariablePhaseInput): ScheduleRow[] {
  if (values.length === 0) throw new RangeError('informe ao menos um valor para a fase variável');
  const byMonth = new Map<YearMonth, Cents>();
  for (const v of values) {
    assertCents(v.amount, `valor de ${v.month}`);
    parseYearMonth(v.month);
    byMonth.set(v.month, v.amount);
  }
  const sorted = [...byMonth.keys()].sort();
  const firstMonth = yearMonthOf(firstDueDate);
  const count = diffYearMonths(firstMonth, lastMonth) + 1;
  if (count < 1) return [];
  const dates = dueDates(firstDueDate, count);
  let last: Cents = byMonth.get(sorted[0] as YearMonth) as Cents;
  const rows: Omit<ScheduleRow, 'balanceAfter'>[] = [];
  for (let k = 0; k < count; k++) {
    const month = addYearMonths(firstMonth, k);
    const informed = byMonth.get(month);
    if (informed !== undefined) last = informed;
    const row: Omit<ScheduleRow, 'balanceAfter'> = {
      number: k + 1,
      dueDate: dates[k] as ISODate,
      amount: informed ?? last,
      principalPart: 0,
      interestPart: informed ?? last,
    };
    if (informed === undefined) row.estimated = true;
    rows.push(row);
  }
  return withBalances(rows);
}

export interface BalloonPhaseInput {
  payments: readonly { dueDate: ISODate; amount: Cents }[];
}

/**
 * Sistema `balloon`: parcelas únicas em datas específicas (intermediárias, anuais).
 * @see RN 6.1
 */
export function balloonSchedule({ payments }: BalloonPhaseInput): ScheduleRow[] {
  const sorted = [...payments].sort((a, b) => compareDates(a.dueDate, b.dueDate));
  return withBalances(
    sorted.map((p, i) => {
      assertCents(p.amount, 'parcela');
      parseISODate(p.dueDate);
      return {
        number: i + 1,
        dueDate: p.dueDate,
        amount: p.amount,
        principalPart: p.amount,
        interestPart: 0,
      };
    }),
  );
}

/**
 * Correção por índice (INCC/IPCA/IGP-M): multiplica as parcelas pendentes por
 * `(1 + índice)`, arredondando cada parte ao centavo. Parcelas já pagas não mudam
 * (passe só as pendentes).
 * @see RN 6.2
 */
export function applyIndexCorrection(
  rows: readonly ScheduleRow[],
  indexRate: number,
): ScheduleRow[] {
  if (!(indexRate > -1)) throw new RangeError(`índice inválido: ${indexRate}`);
  const factor = 1 + indexRate;
  const last = rows.at(-1);
  if (!last) return [];
  const corrected = rows.map((r) => {
    const principalPart = roundHalfUp(r.principalPart * factor);
    const interestPart = roundHalfUp(r.interestPart * factor);
    return { ...r, principalPart, interestPart, amount: principalPart + interestPart };
  });
  // Saldo derivado das partes já arredondadas (mais o resíduo após a última, se houver):
  // fecha no centavo, nunca subestima e não precisa de clamp.
  let balance =
    roundHalfUp(last.balanceAfter * factor) + corrected.reduce((a, r) => a + r.principalPart, 0);
  return corrected.map((r) => {
    balance -= r.principalPart;
    return { ...r, balanceAfter: balance };
  });
}

export type AmortizationMode = 'reduce_term' | 'reduce_installment';

export interface ExtraAmortizationInput {
  system: 'price' | 'sac';
  /** Saldo devedor atual (antes do valor extra). */
  balance: Cents;
  monthlyRate: number;
  /** Quantas parcelas ainda faltam. */
  remainingInstallments: number;
  /** Valor extra que abate o saldo. */
  extra: Cents;
  mode: AmortizationMode;
  /** Vencimento da próxima parcela pendente. */
  nextDueDate: ISODate;
}

/**
 * Amortização extraordinária (price/sac): o extra abate o saldo e as parcelas pendentes
 * são recalculadas. `reduce_term` mantém a parcela (price) ou a amortização (sac) e
 * remove parcelas do fim; `reduce_installment` mantém o prazo e recalcula as parcelas.
 * Retorna o novo cronograma das pendentes (numeradas a partir de 1).
 * @see RN 6.5
 */
export function amortizeExtra(input: ExtraAmortizationInput): ScheduleRow[] {
  const {
    system,
    balance,
    monthlyRate,
    remainingInstallments: n,
    extra,
    mode,
    nextDueDate,
  } = input;
  assertCents(balance, 'saldo');
  assertCents(extra, 'valor extra');
  assertRate(monthlyRate);
  assertCount(n, 'remainingInstallments');
  if (extra <= 0 || extra > balance) throw new RangeError('valor extra deve ser > 0 e <= saldo');
  const newBalance = balance - extra;
  if (newBalance === 0) return [];
  if (mode === 'reduce_installment') {
    const phase = {
      principal: newBalance,
      monthlyRate,
      installments: n,
      firstDueDate: nextDueDate,
    };
    return system === 'price' ? priceSchedule(phase) : sacSchedule(phase);
  }
  if (system === 'price') {
    const payment = pricePayment(balance, monthlyRate, n);
    return scheduleWithPayment(newBalance, monthlyRate, payment, nextDueDate, n);
  }
  // Mantém as amortizações do cronograma pendente (resto na 1ª, RN 5.1) e corta o fim.
  const amortizations: Cents[] = [];
  let remaining = newBalance;
  for (const a of splitCents(balance, n)) {
    if (remaining === 0) break;
    const part = Math.min(a, remaining);
    amortizations.push(part);
    remaining -= part;
  }
  return sacWithAmortization(newBalance, monthlyRate, amortizations, nextDueDate);
}

/**
 * Desconto ao pagar uma parcela futura adiantada com taxa mensal: `valor − valor/(1+i)^m`,
 * arredondado para baixo.
 * @see RN 6.5, RN 5.5
 */
export function earlyPaymentDiscount(amount: Cents, monthlyRate: number, months: number): Cents {
  assertCents(amount, 'parcela');
  assertRate(monthlyRate);
  if (!Number.isInteger(months) || months < 0) throw new RangeError(`meses inválido: ${months}`);
  return presentValueDiscount([{ amount, months }], monthlyRate);
}

export type InstallmentStatus = 'pending' | 'paid' | 'late' | 'partial';

export interface DebtInstallmentState {
  dueDate: ISODate;
  amount: Cents;
  principalPart: Cents;
  interestPart: Cents;
  paidAmount: Cents;
  /** Pago integralmente (inclusive com desconto). */
  paid: boolean;
}

/**
 * Status de uma parcela: `paid`, `partial` (pagou parte), `late` (venceu e não pagou)
 * ou `pending`.
 * @see RN 6.3
 */
export function debtInstallmentStatus(i: DebtInstallmentState, today: ISODate): InstallmentStatus {
  if (i.paid) return 'paid';
  if (i.paidAmount > 0) return 'partial';
  if (compareDates(i.dueDate, today) < 0) return 'late';
  return 'pending';
}

/**
 * Valor para quitar hoje: o principal ainda não amortizado das parcelas não pagas
 * (para price/sac é o saldo devedor, sem juros futuros), menos o que já foi pago de
 * parcelas parciais.
 * @see RN 6.4, 6.5 (Quitação total)
 */
export function payoffAmount(installments: readonly DebtInstallmentState[]): Cents {
  let total = 0;
  for (const i of installments) {
    if (i.paid) continue;
    total += Math.max(0, i.principalPart - i.paidAmount);
  }
  return total;
}

export interface DebtSummary {
  totalCount: number;
  paidCount: number;
  remainingCount: number;
  paidAmount: Cents;
  /** Σ valor das parcelas não pagas (menos pagamentos parciais). */
  remainingAmount: Cents;
  /** Principal ainda não amortizado (valor para quitar hoje). */
  outstandingPrincipal: Cents;
  /** 0–1: pago / (pago + restante). */
  progressByAmount: number;
  /** 0–1 */
  progressByCount: number;
  interestPaid: Cents;
  interestToPay: Cents;
  /** Vencimento da última parcela não paga (ou null se quitada). */
  expectedPayoffDate: ISODate | null;
  lateCount: number;
  lateAmount: Cents;
}

/**
 * Painel da dívida.
 * @see RN 6.4
 */
export function debtSummary(
  installments: readonly DebtInstallmentState[],
  today: ISODate,
): DebtSummary {
  const s: DebtSummary = {
    totalCount: installments.length,
    paidCount: 0,
    remainingCount: 0,
    paidAmount: 0,
    remainingAmount: 0,
    outstandingPrincipal: payoffAmount(installments),
    progressByAmount: 0,
    progressByCount: 0,
    interestPaid: 0,
    interestToPay: 0,
    expectedPayoffDate: null,
    lateCount: 0,
    lateAmount: 0,
  };
  for (const i of installments) {
    assertCents(i.amount, 'parcela');
    assertCents(i.paidAmount, 'pago');
    s.paidAmount += i.paidAmount;
    if (i.paid) {
      s.paidCount++;
      s.interestPaid += i.interestPart;
      continue;
    }
    s.remainingCount++;
    s.remainingAmount += Math.max(0, i.amount - i.paidAmount);
    s.interestToPay += i.interestPart;
    if (s.expectedPayoffDate === null || compareDates(i.dueDate, s.expectedPayoffDate) > 0) {
      s.expectedPayoffDate = i.dueDate;
    }
    if (compareDates(i.dueDate, today) < 0) {
      s.lateCount++;
      s.lateAmount += Math.max(0, i.amount - i.paidAmount);
    }
  }
  const denom = s.paidAmount + s.remainingAmount;
  s.progressByAmount = denom === 0 ? 0 : s.paidAmount / denom;
  s.progressByCount = s.totalCount === 0 ? 0 : s.paidCount / s.totalCount;
  return s;
}

/** Fase de uma dívida. `fixed`/`price`/`sac` podem começar depois da entrega das chaves. */
export type DebtPhase =
  | ({ system: 'fixed'; startsAfterCompletion?: boolean } & FixedPhaseInput)
  | ({ system: 'price' | 'sac'; startsAfterCompletion?: boolean } & AmortizedPhaseInput)
  | ({ system: 'variable'; endsAtCompletion?: boolean } & Omit<VariablePhaseInput, 'lastMonth'> & {
        lastMonth?: YearMonth;
      })
  | ({ system: 'balloon' } & BalloonPhaseInput);

export interface DebtScheduleRow extends ScheduleRow {
  /** Índice da fase (ordem do cadastro). */
  phase: number;
  /** Número dentro da fase. */
  phaseNumber: number;
}

/**
 * Cronograma completo de uma dívida com fases (imóvel na planta), em ordem de vencimento
 * e numerado 1..N. Com `completionDate` (entrega das chaves):
 * - fase `variable` com `endsAtCompletion` termina no mês da entrega;
 * - fases com `startsAfterCompletion` começam no mês seguinte à entrega, no mesmo dia do
 *   `firstDueDate` informado (com clamp).
 * Alterar `completionDate` e chamar de novo regenera essas fases.
 * @see RN 6.7
 */
export function debtSchedule(
  phases: readonly DebtPhase[],
  completionDate?: ISODate | null,
): DebtScheduleRow[] {
  const completionMonth = completionDate ? yearMonthOf(completionDate) : null;
  const afterCompletion = (firstDueDate: ISODate): ISODate => {
    if (!completionMonth) throw new RangeError('fase depende da data de entrega (completionDate)');
    const { year, month } = parseYearMonth(addYearMonths(completionMonth, 1));
    return clampDay(year, month, parseISODate(firstDueDate).day);
  };
  const all: DebtScheduleRow[] = [];
  phases.forEach((phase, index) => {
    let rows: ScheduleRow[];
    switch (phase.system) {
      case 'fixed': {
        const firstDueDate = phase.startsAfterCompletion
          ? afterCompletion(phase.firstDueDate)
          : phase.firstDueDate;
        rows = fixedSchedule({ ...phase, firstDueDate });
        break;
      }
      case 'price':
      case 'sac': {
        const firstDueDate = phase.startsAfterCompletion
          ? afterCompletion(phase.firstDueDate)
          : phase.firstDueDate;
        const input = { ...phase, firstDueDate };
        rows = phase.system === 'price' ? priceSchedule(input) : sacSchedule(input);
        break;
      }
      case 'variable': {
        const lastMonth = phase.endsAtCompletion ? completionMonth : (phase.lastMonth ?? null);
        if (!lastMonth)
          throw new RangeError('fase variável precisa de lastMonth ou da data de entrega');
        rows = variableSchedule({ ...phase, lastMonth });
        break;
      }
      case 'balloon':
        rows = balloonSchedule(phase);
        break;
    }
    for (const r of rows) all.push({ ...r, phase: index, phaseNumber: r.number });
  });
  all.sort(
    (a, b) =>
      compareDates(a.dueDate, b.dueDate) || a.phase - b.phase || a.phaseNumber - b.phaseNumber,
  );
  return all.map((r, i) => ({ ...r, number: i + 1 }));
}

/**
 * Saldo devedor (valor presente) de uma dívida Price em andamento a partir do que o banco
 * mostra: valor da parcela, taxa mensal e quantas parcelas faltam.
 * `PV = PMT · (1 − (1+i)^−n) / i` (com taxa 0, `PMT · n`), arredondado para baixo, para
 * o cronograma gerado nunca cobrar parcela maior que a informada.
 * @see RN 6.1, 6.4
 */
export function principalFromPayment(
  payment: Cents,
  monthlyRate: number,
  installments: number,
): Cents {
  assertCents(payment, 'parcela');
  assertRate(monthlyRate);
  assertCount(installments);
  if (monthlyRate === 0) return payment * installments;
  const pv = (payment * (1 - (1 + monthlyRate) ** -installments)) / monthlyRate;
  return Math.floor(pv + 1e-9);
}
