import { describe, expect, it } from 'vitest';
import { easterSunday, isPastDue, nationalHolidayDates, nationalHolidays } from './index';

describe('easterSunday (Meeus/Butcher)', () => {
  it.each([
    [1961, '1961-04-02'],
    [2000, '2000-04-23'],
    [2019, '2019-04-21'],
    [2024, '2024-03-31'],
    [2025, '2025-04-20'],
    [2026, '2026-04-05'],
    [2027, '2027-03-28'],
    [2038, '2038-04-25'],
    [2285, '2285-03-22'],
  ])('%i → %s', (year, date) => {
    expect(easterSunday(year)).toBe(date);
  });
});

describe('nationalHolidays (RN 2)', () => {
  it('lists 2026 holidays in order', () => {
    expect(nationalHolidays(2026).map((h) => h.date)).toEqual([
      '2026-01-01',
      '2026-02-16',
      '2026-02-17',
      '2026-04-03',
      '2026-04-21',
      '2026-05-01',
      '2026-06-04',
      '2026-09-07',
      '2026-10-12',
      '2026-11-02',
      '2026-11-15',
      '2026-11-20',
      '2026-12-25',
    ]);
  });

  it('can exclude Carnival and Corpus Christi', () => {
    const dates = nationalHolidays(2026, { carnival: false, corpusChristi: false }).map(
      (h) => h.date,
    );
    expect(dates).toHaveLength(10);
    expect(dates).not.toContain('2026-02-16');
    expect(dates).not.toContain('2026-06-04');
    expect(dates).toContain('2026-04-03');
  });

  it('builds a set across years', () => {
    const set = nationalHolidayDates(2026, 2027);
    expect(set.has('2026-12-25')).toBe(true);
    expect(set.has('2027-03-26')).toBe(true); // Sexta-feira Santa 2027
    expect(set.size).toBe(26);
  });
});

describe('isPastDue (RN 2)', () => {
  it('waits for the next business day when the due date is a weekend or holiday', () => {
    // 10/10/2026 é sábado: pode pagar na segunda 12/10? Não, 12/10 é feriado (N. Sra.
    // Aparecida); o primeiro dia útil é terça 13/10.
    expect(isPastDue('2026-10-10', '2026-10-11')).toBe(false);
    expect(isPastDue('2026-10-10', '2026-10-13')).toBe(false);
    expect(isPastDue('2026-10-10', '2026-10-14')).toBe(true);
  });

  it('is overdue the day after a business-day due date', () => {
    expect(isPastDue('2026-10-15', '2026-10-15')).toBe(false);
    expect(isPastDue('2026-10-15', '2026-10-16')).toBe(true);
    expect(isPastDue('2026-10-15', '2026-10-01')).toBe(false);
  });

  it('crosses the year with the next year holidays', () => {
    // 31/12/2026 é quinta (dia útil); 01/01/2027 é feriado.
    expect(isPastDue('2026-12-31', '2027-01-01')).toBe(true);
    // Vencimento no feriado de 01/01/2027 (sexta): paga até segunda 04/01.
    expect(isPastDue('2027-01-01', '2027-01-04')).toBe(false);
    expect(isPastDue('2027-01-01', '2027-01-05')).toBe(true);
  });
});
