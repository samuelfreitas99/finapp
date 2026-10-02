import { describe, expect, it } from 'vitest';
import { formatDate, formatYearMonth, money } from './format';

const nbsp = ' ';

describe('format', () => {
  it('formats money and hides it when asked', () => {
    expect(money(123456)).toBe(`R$${nbsp}1.234,56`);
    expect(money(-500, false, true)).toBe(`-R$${nbsp}5,00`);
    expect(money(123456, true)).toBe('R$ •••••');
  });

  it('formats dates and months', () => {
    expect(formatDate('2026-10-02')).toBe('02/10/2026');
    expect(formatYearMonth(2026, 10)).toBe('out/2026');
  });
});
