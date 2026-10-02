import { addDays, dayOfWeek, daysInMonth, toISODate, type ISODate } from './calendar';

/**
 * Conjunto de datas `YYYY-MM-DD` que não são dias úteis além dos fins de semana
 * (feriados nacionais + locais do espaço). Monte com `nationalHolidayDates` e
 * acrescente os feriados cadastrados na tabela `holidays`.
 * @see RN 2
 */
export type HolidaySet = ReadonlySet<ISODate>;

/** Ajuste para data que cai em dia não útil. @see RN 2 */
export type BusinessDayAdjust = 'none' | 'previous' | 'next';

/** Segunda a sexta que não é feriado. @see RN 2 */
export function isBusinessDay(date: ISODate, holidays: HolidaySet): boolean {
  const dow = dayOfWeek(date);
  return dow !== 0 && dow !== 6 && !holidays.has(date);
}

/**
 * Move a data para um dia útil: `previous` antecipa, `next` adia, `none` mantém.
 * @see RN 2
 */
export function businessDayAdjust(
  date: ISODate,
  mode: BusinessDayAdjust,
  holidays: HolidaySet,
): ISODate {
  if (mode === 'none') return date;
  const step = mode === 'next' ? 1 : -1;
  let current = date;
  while (!isBusinessDay(current, holidays)) current = addDays(current, step);
  return current;
}

/** Todos os dias úteis do mês, em ordem. */
export function businessDaysInMonth(year: number, month: number, holidays: HolidaySet): ISODate[] {
  const days: ISODate[] = [];
  for (let d = 1; d <= daysInMonth(year, month); d++) {
    const date = toISODate(year, month, d);
    if (isBusinessDay(date, holidays)) days.push(date);
  }
  return days;
}

/**
 * N-ésimo dia útil do mês (n >= 1).
 * Ex.: 5º dia útil de setembro/2026 = 2026-09-08 (07/09 é feriado).
 * Lança `RangeError` se o mês não tiver `n` dias úteis.
 * @see RN 2
 */
export function nthBusinessDay(
  year: number,
  month: number,
  n: number,
  holidays: HolidaySet,
): ISODate {
  if (!Number.isInteger(n) || n < 1) throw new RangeError(`n deve ser inteiro >= 1: ${n}`);
  const days = businessDaysInMonth(year, month, holidays);
  const date = days[n - 1];
  if (date === undefined) {
    throw new RangeError(`${year}-${month} tem só ${days.length} dias úteis (pedido: ${n})`);
  }
  return date;
}

/** Último dia útil do mês. @see RN 2 */
export function lastBusinessDay(year: number, month: number, holidays: HolidaySet): ISODate {
  const last = toISODate(year, month, daysInMonth(year, month));
  return businessDayAdjust(last, 'previous', holidays);
}
