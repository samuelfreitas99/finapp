/**
 * Datas de calendário como texto `YYYY-MM-DD`, sem fuso (fuso de referência
 * America/Sao_Paulo é responsabilidade de quem chama, ao obter "hoje").
 * Meses são 1–12. A aritmética interna usa UTC só como contador de dias.
 * @see RN 2
 */

/** Data de calendário no formato `YYYY-MM-DD`. */
export type ISODate = string;

export interface DateParts {
  year: number;
  /** 1–12 */
  month: number;
  day: number;
}

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

/**
 * Milissegundos UTC de uma data. Usa `setUTCFullYear` porque `Date.UTC`
 * remapeia os anos 0–99 para 1900–1999.
 */
function utcMs(year: number, monthIndex: number, day: number): number {
  const d = new Date(0);
  d.setUTCFullYear(year, monthIndex, day);
  return d.getTime();
}

function assertYearMonth(year: number, month: number): void {
  if (!Number.isInteger(year) || year < 1 || year > 9999) {
    throw new RangeError(`ano inválido: ${year}`);
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError(`mês inválido: ${month}`);
  }
}

/** Quantidade de dias do mês (considera ano bissexto). */
export function daysInMonth(year: number, month: number): number {
  assertYearMonth(year, month);
  return new Date(utcMs(year, month, 0)).getUTCDate();
}

/** Verifica se o texto é uma data `YYYY-MM-DD` existente. */
export function isISODate(value: unknown): value is ISODate {
  if (typeof value !== 'string') return false;
  const m = ISO_RE.exec(value);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

/** Separa `YYYY-MM-DD` em ano, mês (1–12) e dia. Lança `RangeError` se inválida. */
export function parseISODate(date: ISODate): DateParts {
  if (!isISODate(date)) throw new RangeError(`data inválida: ${date}`);
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return { year: y, month: m, day: d };
}

/** Monta `YYYY-MM-DD`. Lança `RangeError` se o dia não existir no mês. */
export function toISODate(year: number, month: number, day: number): ISODate {
  assertYearMonth(year, month);
  if (!Number.isInteger(day) || day < 1 || day > daysInMonth(year, month)) {
    throw new RangeError(`dia inválido: ${year}-${month}-${day}`);
  }
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

/**
 * Data do dia `day` no mês; se o dia não existir (31 em abril, 29–31 em fevereiro),
 * usa o último dia do mês.
 * @see RN 2
 */
export function clampDay(year: number, month: number, day: number): ISODate {
  assertYearMonth(year, month);
  if (!Number.isInteger(day) || day < 1) throw new RangeError(`dia inválido: ${day}`);
  return toISODate(year, month, Math.min(day, daysInMonth(year, month)));
}

function toEpochDay(date: ISODate): number {
  const { year, month, day } = parseISODate(date);
  return utcMs(year, month - 1, day) / MS_PER_DAY;
}

function fromEpochDay(epochDay: number): ISODate {
  const d = new Date(epochDay * MS_PER_DAY);
  return toISODate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** Soma (ou subtrai) dias. */
export function addDays(date: ISODate, days: number): ISODate {
  if (!Number.isInteger(days)) throw new RangeError(`dias deve ser inteiro: ${days}`);
  return fromEpochDay(toEpochDay(date) + days);
}

/** Diferença em dias: `b - a` (positivo se `b` é depois de `a`). */
export function diffDays(a: ISODate, b: ISODate): number {
  return toEpochDay(b) - toEpochDay(a);
}

/** Compara duas datas: negativo se `a < b`, 0 se iguais, positivo se `a > b`. */
export function compareDates(a: ISODate, b: ISODate): number {
  return diffDays(b, a);
}

/** Dia da semana: 0 = domingo … 6 = sábado. */
export function dayOfWeek(date: ISODate): number {
  return new Date(toEpochDay(date) * MS_PER_DAY).getUTCDay();
}

/**
 * Soma meses mantendo o dia, com `clampDay` quando o dia não existe no mês de destino.
 * `anchorDay` permite manter o dia original numa série (31/01 → 28/02 → 31/03),
 * em vez de "encolher" para 28 depois de fevereiro.
 * @see RN 2
 */
export function addMonths(date: ISODate, months: number, anchorDay?: number): ISODate {
  if (!Number.isInteger(months)) throw new RangeError(`meses deve ser inteiro: ${months}`);
  const { year, month, day } = parseISODate(date);
  const index = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(index / 12);
  const targetMonth = (index % 12) + 1;
  return clampDay(targetYear, targetMonth, anchorDay ?? day);
}

/** Primeiro dia do mês da data. */
export function startOfMonth(date: ISODate): ISODate {
  const { year, month } = parseISODate(date);
  return toISODate(year, month, 1);
}

/** Último dia do mês da data. */
export function endOfMonth(date: ISODate): ISODate {
  const { year, month } = parseISODate(date);
  return toISODate(year, month, daysInMonth(year, month));
}
