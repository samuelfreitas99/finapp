import { describe, expect, it } from 'vitest';
import { todayIn } from '../dates';
import {
  accountBalance,
  adjustmentAmount,
  monthFlow,
  signedAmount,
  type LedgerEntry,
} from './index';

describe('signedAmount (RN 1)', () => {
  it('uses the type for the sign; adjustments carry their own sign', () => {
    expect(signedAmount('income', 100)).toBe(100);
    expect(signedAmount('transfer_in', 100)).toBe(100);
    expect(signedAmount('expense', 100)).toBe(-100);
    expect(signedAmount('transfer_out', 100)).toBe(-100);
    expect(signedAmount('adjustment', -250)).toBe(-250);
    expect(() => signedAmount('expense', -1)).toThrow(RangeError);
    expect(() => signedAmount('adjustment', 0)).toThrow(RangeError);
    expect(() => signedAmount('income', 1.5)).toThrow(RangeError);
  });
});

describe('accountBalance (RN 1)', () => {
  const entries: LedgerEntry[] = [
    { type: 'income', status: 'settled', amount: 500000, date: '2026-10-01' },
    { type: 'expense', status: 'settled', amount: 12000, date: '2026-10-02' },
    { type: 'transfer_out', status: 'settled', amount: 100000, date: '2026-10-02' },
    // Previsto vencido: não mexe no atual, entra no previsto.
    { type: 'expense', status: 'planned', amount: 3000, date: '2026-09-28' },
    { type: 'expense', status: 'planned', amount: 150000, date: '2026-10-10' },
    { type: 'expense', status: 'planned', amount: 99999, date: '2026-11-05' },
    { type: 'adjustment', status: 'settled', amount: -500, date: '2026-10-03' },
  ];

  it('computes current (settled up to today) and forecast (everything up to the date)', () => {
    expect(accountBalance(10000, entries, '2026-10-03', '2026-10-31')).toEqual({
      current: 10000 + 500000 - 12000 - 100000 - 500,
      forecast: 10000 + 500000 - 12000 - 100000 - 500 - 3000 - 150000,
    });
  });

  it('ignores settled entries dated after today in the current balance', () => {
    const r = accountBalance(0, entries, '2026-10-01');
    expect(r.current).toBe(500000);
    expect(r.forecast).toBe(500000 - 3000);
  });
});

describe('adjustmentAmount (RN 1)', () => {
  it('is the difference to the real balance, or null', () => {
    expect(adjustmentAmount(10000, 9500)).toBe(-500);
    expect(adjustmentAmount(10000, 12000)).toBe(2000);
    expect(adjustmentAmount(10000, 10000)).toBeNull();
  });
});

describe('todayIn', () => {
  it('uses the São Paulo calendar date', () => {
    // 02:30 UTC de 02/10 ainda é 01/10 em São Paulo (UTC−3).
    expect(todayIn(undefined, new Date('2026-10-02T02:30:00Z'))).toBe('2026-10-01');
    expect(todayIn(undefined, new Date('2026-10-02T03:30:00Z'))).toBe('2026-10-02');
  });
});

describe('monthFlow (RN 1)', () => {
  it('sums income and expense by status, ignoring transfers and adjustments', () => {
    expect(
      monthFlow([
        { type: 'income', status: 'settled', amount: 500000 },
        { type: 'income', status: 'planned', amount: 100000 },
        { type: 'expense', status: 'settled', amount: 4590 },
        { type: 'expense', status: 'planned', amount: 150000 },
        { type: 'transfer_out', status: 'settled', amount: 10000 },
        { type: 'transfer_in', status: 'settled', amount: 10000 },
        { type: 'adjustment', status: 'settled', amount: -1240 },
      ]),
    ).toEqual({
      income: { settled: 500000, planned: 100000 },
      expense: { settled: 4590, planned: 150000 },
    });
  });
});
