import { describe, expect, it } from 'vitest';
import { nationalHolidayDates } from '../holidays';
import {
  addDays,
  addMonths,
  businessDayAdjust,
  businessDaysInMonth,
  clampDay,
  compareDates,
  dayOfWeek,
  daysInMonth,
  diffDays,
  endOfMonth,
  isBusinessDay,
  isISODate,
  lastBusinessDay,
  nthBusinessDay,
  parseISODate,
  startOfMonth,
  toISODate,
} from './index';

const holidays = nationalHolidayDates(2025, 2027);
const noHolidays = new Set<string>();

describe('ISO date helpers', () => {
  it('validates dates', () => {
    expect(isISODate('2026-02-28')).toBe(true);
    expect(isISODate('2026-02-29')).toBe(false);
    expect(isISODate('2028-02-29')).toBe(true);
    expect(isISODate('2026-13-01')).toBe(false);
    expect(isISODate('2026-1-01')).toBe(false);
    expect(isISODate(20260101)).toBe(false);
  });

  it('parses and builds', () => {
    expect(parseISODate('2026-09-08')).toEqual({ year: 2026, month: 9, day: 8 });
    expect(toISODate(2026, 9, 8)).toBe('2026-09-08');
    expect(() => parseISODate('2026-04-31')).toThrow(RangeError);
    expect(() => toISODate(2026, 4, 31)).toThrow(RangeError);
  });

  it('knows days in month', () => {
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2100, 2)).toBe(28);
    expect(daysInMonth(2000, 2)).toBe(29);
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
  });
});

describe('clampDay (RN 2)', () => {
  it('uses the last day when the day does not exist', () => {
    expect(clampDay(2026, 4, 31)).toBe('2026-04-30');
    expect(clampDay(2026, 2, 30)).toBe('2026-02-28');
    expect(clampDay(2028, 2, 31)).toBe('2028-02-29');
    expect(clampDay(2026, 1, 15)).toBe('2026-01-15');
  });
});

describe('day arithmetic', () => {
  it('adds days across months and years', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(diffDays('2026-01-01', '2026-12-31')).toBe(364);
    expect(compareDates('2026-01-02', '2026-01-01')).toBeGreaterThan(0);
    expect(compareDates('2026-01-01', '2026-01-01')).toBe(0);
  });

  it('gets day of week', () => {
    expect(dayOfWeek('2026-09-01')).toBe(2); // terça
    expect(dayOfWeek('2026-10-04')).toBe(0); // domingo
  });

  it('gets month bounds', () => {
    expect(startOfMonth('2026-02-17')).toBe('2026-02-01');
    expect(endOfMonth('2026-02-17')).toBe('2026-02-28');
  });
});

describe('addMonths (RN 2)', () => {
  it('keeps the day and clamps', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-01-15', 13)).toBe('2027-02-15');
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28');
    expect(addMonths('2026-01-10', -1)).toBe('2025-12-10');
    expect(addMonths('2026-11-30', 3)).toBe('2027-02-28');
  });

  it('keeps an anchor day across a series', () => {
    expect(addMonths('2026-02-28', 1, 31)).toBe('2026-03-31');
    const series = [0, 1, 2, 3].map((i) => addMonths('2026-01-31', i, 31));
    expect(series).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  });
});

describe('business days (RN 2)', () => {
  it('skips weekends and holidays', () => {
    expect(isBusinessDay('2026-09-07', holidays)).toBe(false); // Independência
    expect(isBusinessDay('2026-09-05', holidays)).toBe(false); // sábado
    expect(isBusinessDay('2026-09-08', holidays)).toBe(true);
    expect(isBusinessDay('2026-09-07', noHolidays)).toBe(true);
  });

  it('5º dia útil de setembro/2026 = 2026-09-08', () => {
    expect(nthBusinessDay(2026, 9, 5, holidays)).toBe('2026-09-08');
  });

  it('5º dia útil de outubro/2026 = 2026-10-07', () => {
    expect(nthBusinessDay(2026, 10, 5, holidays)).toBe('2026-10-07');
  });

  it('1º dia útil de janeiro/2027 pula o feriado de 01/01', () => {
    expect(nthBusinessDay(2027, 1, 1, holidays)).toBe('2027-01-04');
  });

  it('5º dia útil de fevereiro/2026 considera o Carnaval', () => {
    // 02 seg, 03, 04, 05, 06 sex → 5º = 06/02 (Carnaval é 16-17/02, não afeta)
    expect(nthBusinessDay(2026, 2, 5, holidays)).toBe('2026-02-06');
    // 10º: 09, 10, 11, 12, 13, (16-17 Carnaval) 18 → 18/02
    expect(nthBusinessDay(2026, 2, 11, holidays)).toBe('2026-02-18');
  });

  it('rejects n out of range', () => {
    expect(() => nthBusinessDay(2026, 9, 0, holidays)).toThrow(RangeError);
    const count = businessDaysInMonth(2026, 9, holidays).length;
    expect(count).toBe(21);
    expect(() => nthBusinessDay(2026, 9, count + 1, holidays)).toThrow(RangeError);
  });

  it('last business day', () => {
    expect(lastBusinessDay(2026, 10, holidays)).toBe('2026-10-30'); // 31 é sábado
    expect(lastBusinessDay(2026, 12, holidays)).toBe('2026-12-31');
    expect(lastBusinessDay(2027, 1, holidays)).toBe('2027-01-29'); // 30-31 fim de semana
  });

  it('adjusts non-business days', () => {
    // 07/09/2026 segunda (feriado)
    expect(businessDayAdjust('2026-09-07', 'next', holidays)).toBe('2026-09-08');
    expect(businessDayAdjust('2026-09-07', 'previous', holidays)).toBe('2026-09-04');
    expect(businessDayAdjust('2026-09-07', 'none', holidays)).toBe('2026-09-07');
    expect(businessDayAdjust('2026-09-08', 'next', holidays)).toBe('2026-09-08');
    // Sexta-feira Santa 03/04/2026 + fim de semana
    expect(businessDayAdjust('2026-04-03', 'next', holidays)).toBe('2026-04-06');
  });
});
