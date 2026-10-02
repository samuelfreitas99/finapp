import type { Cents } from '../money';
import { assertCents } from '../money';
import {
  addDays,
  businessDayAdjust,
  clampDay,
  compareDates,
  lastBusinessDay,
  nthBusinessDay,
  parseISODate,
  toISODate,
  type BusinessDayAdjust,
  type HolidaySet,
  type ISODate,
  type YearMonth,
} from '../dates';

/**
 * Recorrências (receitas e despesas fixas, salário em partes): geram as ocorrências
 * previstas dentro de uma janela de datas.
 * @see RN 3
 */

export type Frequency = 'monthly' | 'weekly' | 'yearly' | 'every_n_months';

/** Regra do dia da ocorrência dentro do mês. @see RN 3 */
export type DayRule =
  | { kind: 'fixed_day'; day: number }
  | { kind: 'nth_business_day'; n: number }
  | { kind: 'last_business_day' };

/** Parte de um valor dividido (ex.: adiantamento + salário). Informe `amount` **ou** `percent`. */
export interface RecurrencePart {
  label?: string;
  amount?: Cents;
  /** Percentual do valor total (0–100, até 2 casas). */
  percent?: number;
  dayRule: DayRule;
  /** Só para `fixed_day`. Padrão `none`. */
  adjust?: BusinessDayAdjust;
  /** 0 = mesmo mês de referência, 1 = mês seguinte... Padrão 0. */
  monthOffset?: number;
}

export interface RecurrenceRule {
  frequency: Frequency;
  /** Intervalo para `every_n_months` (meses) e `weekly` (semanas). Padrão 1. */
  interval?: number;
  /** Ignorado em `weekly` (o dia da semana é o de `startDate`) e quando há `parts`. */
  dayRule?: DayRule;
  /** Só para `fixed_day`. Padrão `none`. */
  adjust?: BusinessDayAdjust;
  startDate: ISODate;
  endDate?: ISODate | null;
  amount: Cents;
  parts?: RecurrencePart[] | null;
}

export interface Occurrence {
  date: ISODate;
  amount: Cents;
  /** Mês de referência (competência) que gerou a ocorrência. */
  reference: YearMonth;
  /** Índice da parte (quando a recorrência tem `parts`). */
  part?: number;
  label?: string;
}

export interface GenerateOptions {
  from: ISODate;
  to: ISODate;
  holidays: HolidaySet;
}

function monthIndex(year: number, month: number): number {
  return year * 12 + (month - 1);
}

function fromMonthIndex(index: number): { year: number; month: number } {
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

function formatYearMonth(index: number): YearMonth {
  const { year, month } = fromMonthIndex(index);
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}

/**
 * Data do dia definido pela regra no mês. `adjust` só vale para `fixed_day`.
 * @see RN 2, RN 3
 */
export function resolveDayRule(
  year: number,
  month: number,
  rule: DayRule,
  adjust: BusinessDayAdjust,
  holidays: HolidaySet,
): ISODate {
  switch (rule.kind) {
    case 'fixed_day':
      return businessDayAdjust(clampDay(year, month, rule.day), adjust, holidays);
    case 'nth_business_day':
      return nthBusinessDay(year, month, rule.n, holidays);
    case 'last_business_day':
      return lastBusinessDay(year, month, holidays);
  }
}

/**
 * Valor de cada parte. Partes com `percent` usam `floor`; se todas forem percentuais,
 * a **última recebe o resto** para a soma bater no centavo. A soma tem que dar o total.
 * @see RN 3 (Salário dividido)
 */
export function splitParts(total: Cents, parts: readonly RecurrencePart[]): Cents[] {
  assertCents(total, 'valor');
  if (parts.length === 0) throw new RangeError('parts não pode ser vazio');
  const allPercent = parts.every((p) => p.percent !== undefined);
  const amounts = parts.map((p, i) => {
    const hasAmount = p.amount !== undefined;
    const hasPercent = p.percent !== undefined;
    if (hasAmount === hasPercent) {
      throw new RangeError(`parte ${i + 1}: informe amount ou percent (só um)`);
    }
    if (hasAmount) {
      assertCents(p.amount, `parte ${i + 1}`);
      return p.amount as Cents;
    }
    const percent = p.percent as number;
    if (!(percent >= 0 && percent <= 100)) {
      throw new RangeError(`parte ${i + 1}: percent fora de 0–100`);
    }
    // Percentual em centésimos de ponto, para não acumular erro de float.
    return Math.floor((total * Math.round(percent * 100)) / 10000);
  });
  if (allPercent) {
    const others = amounts.slice(0, -1).reduce((a, b) => a + b, 0);
    amounts[amounts.length - 1] = total - others;
    const percentSum = parts.reduce((a, p) => a + Math.round((p.percent as number) * 100), 0);
    if (percentSum !== 10000) throw new RangeError('a soma dos percentuais deve ser 100');
  }
  const sum = amounts.reduce((a, b) => a + b, 0);
  if (sum !== total) {
    throw new RangeError(`a soma das partes (${sum}) difere do valor (${total})`);
  }
  return amounts;
}

function stepMonths(rule: RecurrenceRule): number {
  const interval = rule.interval ?? 1;
  if (!Number.isInteger(interval) || interval < 1) {
    throw new RangeError(`interval deve ser inteiro >= 1: ${interval}`);
  }
  switch (rule.frequency) {
    case 'monthly':
      return 1;
    case 'every_n_months':
      return interval;
    case 'yearly':
      return 12;
    case 'weekly':
      return 0;
  }
}

function inRange(date: ISODate, from: ISODate, to: ISODate): boolean {
  return compareDates(date, from) >= 0 && compareDates(date, to) <= 0;
}

/**
 * Gera as ocorrências da recorrência com data entre `from` e `to` (inclusive), em ordem.
 *
 * - Nada é gerado antes de `startDate`.
 * - Sem `parts`: ocorrências depois de `endDate` não são geradas.
 * - Com `parts`: `startDate`/`endDate` delimitam o **mês de referência**; uma parte com
 *   `monthOffset` pode cair depois de `endDate` (o salário de setembro pago em outubro).
 * @see RN 3
 */
export function generateOccurrences(rule: RecurrenceRule, options: GenerateOptions): Occurrence[] {
  const { from, to, holidays } = options;
  assertCents(rule.amount, 'valor');
  const start = rule.startDate;
  const end = rule.endDate ?? null;
  if (compareDates(from, to) > 0) return [];

  if (rule.frequency === 'weekly') {
    if (rule.parts?.length) throw new RangeError('recorrência semanal não aceita parts');
    const stepDays = 7 * (rule.interval ?? 1);
    stepMonths(rule); // valida interval
    const result: Occurrence[] = [];
    // Pula direto para perto de `from`.
    const behind = Math.max(0, Math.floor(-compareDates(start, from) / stepDays));
    for (let k = behind; ; k++) {
      const base = addDays(start, k * stepDays);
      if (compareDates(base, to) > 0) break;
      if (end && compareDates(base, end) > 0) break;
      const date = businessDayAdjust(base, rule.adjust ?? 'none', holidays);
      if (compareDates(date, start) >= 0 && inRange(date, from, to)) {
        const { year, month } = parseISODate(base);
        result.push({
          date,
          amount: rule.amount,
          reference: formatYearMonth(monthIndex(year, month)),
        });
      }
    }
    return result;
  }

  const step = stepMonths(rule);
  const parts = rule.parts?.length ? rule.parts : null;
  const singleRule = rule.dayRule;
  if (!parts && !singleRule) throw new RangeError('informe dayRule ou parts');

  const items = parts
    ? splitParts(rule.amount, parts).map((amount, i) => {
        const p = parts[i] as RecurrencePart;
        const monthOffset = p.monthOffset ?? 0;
        if (!Number.isInteger(monthOffset) || monthOffset < 0) {
          throw new RangeError(`parte ${i + 1}: monthOffset deve ser inteiro >= 0`);
        }
        return {
          amount,
          dayRule: p.dayRule,
          adjust: p.adjust ?? 'none',
          monthOffset,
          part: i,
          label: p.label,
        };
      })
    : [
        {
          amount: rule.amount,
          dayRule: singleRule as DayRule,
          adjust: rule.adjust ?? 'none',
          monthOffset: 0,
          part: undefined,
          label: undefined,
        },
      ];
  const maxOffset = Math.max(...items.map((i) => i.monthOffset));

  const s = parseISODate(start);
  const startIdx = monthIndex(s.year, s.month);
  const f = parseISODate(from);
  const t = parseISODate(to);
  const lastRefIdx = monthIndex(t.year, t.month);
  let endRefIdx = Number.POSITIVE_INFINITY;
  if (end) {
    const e = parseISODate(end);
    endRefIdx = monthIndex(e.year, e.month);
  }
  // Primeiro mês de referência que pode gerar algo a partir de `from`, alinhado ao passo.
  const firstUseful = monthIndex(f.year, f.month) - maxOffset - 1;
  const skip = Math.max(0, Math.ceil((firstUseful - startIdx) / step));

  const result: Occurrence[] = [];
  for (
    let refIdx = startIdx + skip * step;
    refIdx <= lastRefIdx && refIdx <= endRefIdx;
    refIdx += step
  ) {
    for (const item of items) {
      const { year, month } = fromMonthIndex(refIdx + item.monthOffset);
      const date = resolveDayRule(year, month, item.dayRule, item.adjust, holidays);
      if (compareDates(date, start) < 0) continue;
      if (!parts && end && compareDates(date, end) > 0) continue;
      if (!inRange(date, from, to)) continue;
      const occ: Occurrence = { date, amount: item.amount, reference: formatYearMonth(refIdx) };
      if (item.part !== undefined) occ.part = item.part;
      if (item.label !== undefined) occ.label = item.label;
      result.push(occ);
    }
  }
  return result.sort((a, b) => compareDates(a.date, b.date) || (a.part ?? 0) - (b.part ?? 0));
}

/**
 * Edição "a partir deste mês": encerra a regra atual no último dia do mês anterior e
 * cria uma nova começando no dia 1 do mês informado, com as mudanças aplicadas.
 * Lançamentos já efetivados não são afetados (responsabilidade de quem persiste).
 * @see RN 3 (Edição)
 */
export function splitRecurrenceFrom(
  rule: RecurrenceRule,
  fromMonth: YearMonth,
  changes: Partial<Omit<RecurrenceRule, 'startDate'>>,
): { previous: RecurrenceRule; next: RecurrenceRule } {
  const m = /^(\d{4})-(\d{2})$/.exec(fromMonth);
  if (!m) throw new RangeError(`mês inválido: ${fromMonth}`);
  const newStart = toISODate(Number(m[1]), Number(m[2]), 1);
  if (compareDates(newStart, rule.startDate) <= 0) {
    throw new RangeError('o mês da alteração deve ser depois do início da recorrência');
  }
  return {
    previous: { ...rule, endDate: addDays(newStart, -1) },
    next: { ...rule, ...changes, startDate: newStart },
  };
}
