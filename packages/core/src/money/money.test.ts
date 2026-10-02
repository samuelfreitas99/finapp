import { describe, expect, it } from 'vitest';
import {
  assertCents,
  formatBRL,
  isCents,
  parseBRL,
  splitCents,
  sumCents,
  totalFromInstallment,
} from './index';

const nbsp = '\u00a0';

describe('isCents / assertCents', () => {
  it('accepts safe integers only', () => {
    expect(isCents(0)).toBe(true);
    expect(isCents(-1050)).toBe(true);
    expect(isCents(10.5)).toBe(false);
    expect(isCents('100')).toBe(false);
    expect(isCents(Number.MAX_SAFE_INTEGER + 1)).toBe(false);
    expect(() => assertCents(0.1)).toThrow(RangeError);
  });
});

describe('sumCents', () => {
  it('sums integers and rejects floats', () => {
    expect(sumCents([100, 250, -50])).toBe(300);
    expect(sumCents([])).toBe(0);
    expect(() => sumCents([1, 0.5])).toThrow(RangeError);
  });
});

describe('splitCents (RN 5.1)', () => {
  it('gives the remainder to the first part: 10000 in 3x', () => {
    expect(splitCents(10000, 3)).toEqual([3334, 3333, 3333]);
  });

  it('splits evenly when possible', () => {
    expect(splitCents(12000, 12)).toEqual(Array(12).fill(1000));
  });

  it('always sums back to the total', () => {
    for (const [total, n] of [
      [1, 3],
      [99999, 7],
      [100, 1],
      [5, 10],
    ] as const) {
      const parts = splitCents(total, n);
      expect(parts).toHaveLength(n);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
    }
  });

  it('handles totals smaller than n', () => {
    expect(splitCents(2, 3)).toEqual([2, 0, 0]);
  });

  it('mirrors the sign for negative totals', () => {
    expect(splitCents(-10000, 3)).toEqual([-3334, -3333, -3333]);
  });

  it('rejects invalid input', () => {
    expect(() => splitCents(100, 0)).toThrow(RangeError);
    expect(() => splitCents(100, 1.5)).toThrow(RangeError);
    expect(() => splitCents(10.5, 2)).toThrow(RangeError);
  });
});

describe('totalFromInstallment (RN 5.1)', () => {
  it('multiplies installment by n', () => {
    expect(totalFromInstallment(3333, 3)).toBe(9999);
    expect(() => totalFromInstallment(100, 0)).toThrow(RangeError);
  });
});

describe('formatBRL', () => {
  it('formats in pt-BR', () => {
    expect(formatBRL(123456)).toBe(`R$${nbsp}1.234,56`);
    expect(formatBRL(7)).toBe(`R$${nbsp}0,07`);
    expect(formatBRL(0)).toBe(`R$${nbsp}0,00`);
    expect(formatBRL(100000000)).toBe(`R$${nbsp}1.000.000,00`);
  });

  it('handles sign', () => {
    expect(formatBRL(-1050)).toBe(`-R$${nbsp}10,50`);
    expect(formatBRL(1050, { signed: true })).toBe(`+R$${nbsp}10,50`);
    expect(formatBRL(0, { signed: true })).toBe(`R$${nbsp}0,00`);
  });

  it('can omit the symbol', () => {
    expect(formatBRL(123456, { symbol: false })).toBe('1.234,56');
  });
});

describe('parseBRL', () => {
  it.each([
    ['1.234,56', 123456],
    ['1234,56', 123456],
    ['1234,5', 123450],
    ['R$ 10', 1000],
    [`R$${nbsp}1.000.000,00`, 100000000],
    ['0,07', 7],
    ['-3,99', -399],
    ['+5', 500],
    ['-0', 0],
  ])('parses %s', (input, expected) => {
    expect(parseBRL(input)).toBe(expected);
  });

  it.each(['', 'abc', '1,234', '1.23,45', '12,345', '1.2345', '10.5'])('rejects %s', (input) => {
    expect(parseBRL(input)).toBeNull();
  });

  it('round-trips with formatBRL', () => {
    for (const cents of [0, 1, 99, 123456, -98765]) {
      expect(parseBRL(formatBRL(cents))).toBe(cents);
    }
  });
});
