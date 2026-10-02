import type { ISODate } from './calendar';

/** Fuso de referência do app. @see ADR-006 */
export const REFERENCE_TIME_ZONE = 'America/Sao_Paulo';

/** Data de calendário "hoje" no fuso informado (padrão America/Sao_Paulo). */
export function todayIn(timeZone = REFERENCE_TIME_ZONE, now: Date = new Date()): ISODate {
  // en-CA formata como YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
