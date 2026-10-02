import {
  addDays,
  dayOfWeek,
  endOfMonth,
  parseYearMonth,
  todayIn,
  toYearMonth,
  type ISODate,
  type YearMonth,
} from '@finapp/core';
import { formatYearMonth } from './format';

const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

export const today = (): ISODate => todayIn();

/** "Hoje", "Ontem", "Amanhã" ou "qua, 30/09". */
export function dayLabel(date: ISODate, ref: ISODate = today()): string {
  if (date === ref) return 'Hoje';
  if (date === addDays(ref, -1)) return 'Ontem';
  if (date === addDays(ref, 1)) return 'Amanhã';
  const [, m, d] = date.split('-');
  return `${WEEKDAYS[dayOfWeek(date)]}, ${d}/${m}`;
}

export function monthRange(ym: YearMonth): { from: ISODate; to: ISODate } {
  const from = `${ym}-01`;
  return { from, to: endOfMonth(from) };
}

export function monthLabel(ym: YearMonth): string {
  const { year, month } = parseYearMonth(ym);
  return formatYearMonth(year, month);
}

export const currentMonth = (): YearMonth => today().slice(0, 7);

export { toYearMonth };
