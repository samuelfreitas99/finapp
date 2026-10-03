import { addMonths, type ISODate } from '../dates';

export type ReminderRepeat = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';

/**
 * Próximo horário de um lembrete que se repete (mantém a hora; mês curto usa o último
 * dia). `none` não tem próximo.
 */
export function nextReminderAt(dueAt: string, repeat: ReminderRepeat): string | null {
  if (repeat === 'none') return null;
  const d = new Date(dueAt);
  if (Number.isNaN(d.getTime())) throw new RangeError(`horário inválido: ${dueAt}`);
  if (repeat === 'daily' || repeat === 'weekly') {
    d.setUTCDate(d.getUTCDate() + (repeat === 'daily' ? 1 : 7));
    return d.toISOString();
  }
  const date = d.toISOString().slice(0, 10) as ISODate;
  const next = addMonths(date, repeat === 'monthly' ? 1 : 12);
  return `${next}${d.toISOString().slice(10)}`;
}
