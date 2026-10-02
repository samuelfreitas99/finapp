import { describe, expect, it } from 'vitest';
import { projectCashFlow, type ProjectionEntry } from './index';

const entries: ProjectionEntry[] = [
  { date: '2026-10-07', amount: 300000, kind: 'income' },
  { date: '2026-10-15', amount: 200000, kind: 'income' },
  { date: '2026-10-10', amount: 150000, kind: 'invoice' },
  { date: '2026-10-05', amount: 120000, kind: 'fixed_expense' },
  { date: '2026-10-20', amount: 80000, kind: 'debt' },
  { date: '2026-10-25', amount: 10000, kind: 'other_expense' },
  { date: '2026-11-10', amount: 700000, kind: 'invoice' },
  { date: '2026-11-15', amount: 200000, kind: 'income' },
];

describe('projectCashFlow (RN 7)', () => {
  it('chains months and computes committed/free', () => {
    const [oct, nov, dec] = projectCashFlow({
      startingBalance: 100000,
      startMonth: '2026-10',
      months: 3,
      entries,
    });
    expect(oct).toEqual({
      month: '2026-10',
      openingBalance: 100000,
      income: 500000,
      fixedExpenses: 120000,
      invoices: 150000,
      debts: 80000,
      otherExpenses: 10000,
      committed: 350000,
      free: 150000,
      closingBalance: 240000,
      negative: false,
    });
    expect(nov).toMatchObject({ openingBalance: 240000, closingBalance: -260000, negative: true });
    expect(dec).toMatchObject({ openingBalance: -260000, closingBalance: -260000, negative: true });
  });

  it('puts overdue planned expenses in the first month and drops overdue income', () => {
    const [oct] = projectCashFlow({
      startingBalance: 0,
      startMonth: '2026-10',
      months: 1,
      entries: [
        { date: '2026-09-28', amount: 5000, kind: 'fixed_expense' },
        { date: '2026-09-28', amount: 9000, kind: 'income' },
        { date: '2026-11-01', amount: 9000, kind: 'income' },
      ],
    });
    expect(oct).toMatchObject({ fixedExpenses: 5000, income: 0, closingBalance: -5000 });
  });

  it('defaults to 12 months and validates input', () => {
    expect(
      projectCashFlow({ startingBalance: 0, startMonth: '2026-10', entries: [] }),
    ).toHaveLength(12);
    expect(
      projectCashFlow({ startingBalance: 0, startMonth: '2026-10', entries: [] }).at(-1)?.month,
    ).toBe('2027-09');
    expect(() =>
      projectCashFlow({ startingBalance: 0, startMonth: '2026-10', months: 37, entries: [] }),
    ).toThrow(RangeError);
    expect(() =>
      projectCashFlow({
        startingBalance: 0,
        startMonth: '2026-10',
        entries: [{ date: '2026-10-01', amount: -1, kind: 'income' }],
      }),
    ).toThrow(RangeError);
  });
});
