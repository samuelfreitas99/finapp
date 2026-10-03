import { describe, expect, it } from 'vitest';
import { buildAlerts, inQuietHours, type AlertInput } from './index';

const base: AlertInput = {
  today: '2026-10-15',
  settings: {},
  planned: [],
  invoices: [],
  cards: [],
  forecastEndOfMonth: 100,
};

describe('buildAlerts (RN 9)', () => {
  it('warns about expenses due soon, due today and overdue, once each', () => {
    const alerts = buildAlerts({
      ...base,
      planned: [
        { id: 'a', type: 'expense', description: 'Internet', amount: 11990, date: '2026-10-17' },
        { id: 'b', type: 'expense', description: 'Luz', amount: 18000, date: '2026-10-15' },
        { id: 'c', type: 'expense', description: 'Água', amount: 9000, date: '2026-10-12' },
        { id: 'd', type: 'expense', description: 'Seguro', amount: 5000, date: '2026-10-25' },
        { id: 'e', type: 'income', description: 'Freela', amount: 100000, date: '2026-10-14' },
      ],
    });
    expect(alerts.map((a) => [a.type, a.dedupeKey])).toEqual([
      ['due_soon', 'due_soon:a:2026-10-17:advance'],
      ['due_soon', 'due_soon:b:2026-10-15:today'],
      ['overdue', 'overdue:c:2026-10-12'],
      ['income_unconfirmed', 'income_unconfirmed:e:2026-10-14'],
    ]);
    expect(alerts[0]?.title).toBe('Vence em 2 dias: Internet');
    expect(alerts[1]?.title).toBe('Vence hoje: Luz');
  });

  it('respects disabled types and days before', () => {
    const alerts = buildAlerts({
      ...base,
      settings: {
        due_soon: { enabled: true, daysBefore: 1 },
        overdue: { enabled: false, daysBefore: 3 },
      },
      planned: [
        { id: 'a', type: 'expense', description: 'Internet', amount: 1, date: '2026-10-17' },
        { id: 'c', type: 'expense', description: 'Água', amount: 1, date: '2026-10-12' },
      ],
    });
    expect(alerts).toEqual([]);
  });

  it('warns about invoices, card limit and negative forecast', () => {
    const inv = {
      id: 'i1',
      cardId: 'c1',
      cardName: 'Nubank',
      referenceMonth: '2026-11',
      closingDate: '2026-10-16',
      dueDate: '2026-10-23',
      total: 120000,
      remaining: 120000,
    };
    const alerts = buildAlerts({
      ...base,
      invoices: [
        inv,
        {
          ...inv,
          id: 'i0',
          referenceMonth: '2026-10',
          closingDate: '2026-10-15',
          dueDate: '2026-10-17',
          total: 5000,
          remaining: 5000,
        },
      ],
      cards: [
        {
          cardId: 'c1',
          cardName: 'Nubank',
          limit: 100000,
          available: 15000,
          currentMonth: '2026-11',
        },
      ],
      forecastEndOfMonth: -2500,
    });
    expect(alerts.map((a) => a.type)).toEqual([
      'invoice_closing',
      'invoice_closed',
      'invoice_due',
      'card_limit',
      'negative_forecast',
    ]);
    expect(alerts.find((a) => a.type === 'card_limit')?.title).toBe('Nubank: 85% do limite usado');
    expect(alerts.at(-1)?.dedupeKey).toBe('negative_forecast:2026-10');
  });
});

describe('inQuietHours', () => {
  it('handles windows across midnight', () => {
    expect(inQuietHours('23:30', '22:00', '07:00')).toBe(true);
    expect(inQuietHours('06:59', '22:00', '07:00')).toBe(true);
    expect(inQuietHours('08:00', '22:00', '07:00')).toBe(false);
    expect(inQuietHours('13:00', '12:00', '14:00')).toBe(true);
    expect(inQuietHours('13:00', null, null)).toBe(false);
  });
});
