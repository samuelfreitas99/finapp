import { parseISODate, type ISODate } from './calendar';

/** Mês no formato `YYYY-MM` (mês de referência, competência, fatura). */
export type YearMonth = string;

const YM_RE = /^(\d{4})-(\d{2})$/;

/** Verifica se o texto é um mês `YYYY-MM` válido. */
export function isYearMonth(value: unknown): value is YearMonth {
  if (typeof value !== 'string') return false;
  const m = YM_RE.exec(value);
  return !!m && Number(m[1]) >= 1 && Number(m[2]) >= 1 && Number(m[2]) <= 12;
}

/** Separa `YYYY-MM` em ano e mês (1–12). */
export function parseYearMonth(ym: YearMonth): { year: number; month: number } {
  if (!isYearMonth(ym)) throw new RangeError(`mês inválido: ${ym}`);
  const [year, month] = ym.split('-').map(Number) as [number, number];
  return { year, month };
}

/** Monta `YYYY-MM`. */
export function toYearMonth(year: number, month: number): YearMonth {
  const ym = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
  if (!isYearMonth(ym)) throw new RangeError(`mês inválido: ${year}-${month}`);
  return ym;
}

/** Mês da data. */
export function yearMonthOf(date: ISODate): YearMonth {
  const { year, month } = parseISODate(date);
  return toYearMonth(year, month);
}

/** Soma meses a um `YYYY-MM`. */
export function addYearMonths(ym: YearMonth, months: number): YearMonth {
  if (!Number.isInteger(months)) throw new RangeError(`meses deve ser inteiro: ${months}`);
  const { year, month } = parseYearMonth(ym);
  const index = year * 12 + (month - 1) + months;
  return toYearMonth(Math.floor(index / 12), (index % 12) + 1);
}

/** Diferença em meses: `b - a`. */
export function diffYearMonths(a: YearMonth, b: YearMonth): number {
  const pa = parseYearMonth(a);
  const pb = parseYearMonth(b);
  return pb.year * 12 + pb.month - (pa.year * 12 + pa.month);
}
