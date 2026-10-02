import type { DayRuleBody, Recurrence } from '@finapp/shared';
import { monthShort } from './format';

const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

export function dayRuleText(rule: DayRuleBody | null | undefined): string {
  if (!rule) return '';
  if (rule.kind === 'fixed_day') return `dia ${rule.day}`;
  if (rule.kind === 'nth_business_day') return `${rule.n}º dia útil`;
  return 'último dia útil';
}

/** "Todo mês, dia 10", "Toda semana, segunda", "A cada 3 meses, 5º dia útil"... */
export function recurrenceText(
  r: Pick<Recurrence, 'frequency' | 'interval' | 'dayRule' | 'parts' | 'startDate'>,
): string {
  const rule = r.parts?.length
    ? r.parts
        .map((p) => dayRuleText(p.dayRule) + (p.monthOffset ? ' do mês seguinte' : ''))
        .join(' e ')
    : dayRuleText(r.dayRule);
  switch (r.frequency) {
    case 'weekly': {
      const day = WEEKDAYS[new Date(`${r.startDate}T12:00:00Z`).getUTCDay()];
      return r.interval > 1 ? `A cada ${r.interval} semanas, ${day}` : `Toda semana, ${day}`;
    }
    case 'yearly':
      return `Todo ano em ${monthShort(Number(r.startDate.slice(5, 7)))}, ${rule}`;
    case 'every_n_months':
      return `A cada ${r.interval} meses, ${rule}`;
    default:
      return `Todo mês, ${rule}`;
  }
}
