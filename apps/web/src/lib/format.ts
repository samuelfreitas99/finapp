import { formatBRL, parseISODate, type ISODate } from '@finapp/core';

export { formatBRL };

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** "R$ 1.234,56" ou "R$ •••••" quando os valores estão ocultos. */
export function money(cents: number, hidden = false, signed = false): string {
  if (hidden) return 'R$ •••••';
  return formatBRL(cents, { signed });
}

/** `dd/mm/aaaa`. */
export function formatDate(date: ISODate): string {
  const { year, month, day } = parseISODate(date);
  return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
}

/** Nome curto do mês: "out". */
export function monthShort(month: number): string {
  return MONTHS[month - 1] ?? '';
}

/** "out/2026". */
export function formatYearMonth(year: number, month: number): string {
  return `${monthShort(month)}/${year}`;
}
