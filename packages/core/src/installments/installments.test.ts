import { describe, expect, it } from 'vitest';
import { addYearMonths } from '../dates';
import { nationalHolidayDates } from '../holidays';
import {
  accountInstallments,
  anticipateInstallments,
  cancelPlan,
  cardInstallments,
  planSummary,
  type PlannedInstallment,
} from './index';

const card = { closingDay: 3, dueDay: 10 };

describe('cardInstallments (RN 5.1, 5.2)', () => {
  it('splits 10000 in 3x and spreads over invoices', () => {
    expect(
      cardInstallments({ card, totalAmount: 10000, installments: 3, firstDate: '2026-10-02' }),
    ).toEqual([
      { number: 1, amount: 3334, date: '2026-10-02', invoiceMonth: '2026-10' },
      { number: 2, amount: 3333, date: '2026-11-02', invoiceMonth: '2026-11' },
      { number: 3, amount: 3333, date: '2026-12-02', invoiceMonth: '2026-12' },
    ]);
  });

  it('a purchase on the closing day starts on the next invoice', () => {
    const plan = cardInstallments({
      card,
      totalAmount: 10000,
      installments: 2,
      firstDate: '2026-10-03',
    });
    expect(plan.map((i) => i.invoiceMonth)).toEqual(['2026-11', '2026-12']);
  });

  it('accepts the installment value instead of the total', () => {
    const plan = cardInstallments({
      card,
      installmentAmount: 3333,
      installments: 3,
      firstDate: '2026-10-02',
    });
    expect(plan.map((i) => i.amount)).toEqual([3333, 3333, 3333]);
  });

  it('keeps the purchase day for dates (clamped)', () => {
    const plan = cardInstallments({
      card,
      totalAmount: 400,
      installments: 4,
      firstDate: '2026-01-31',
    });
    expect(plan.map((i) => i.date)).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
    ]);
  });

  it('plan in progress: 4 of 10 goes into the current invoice (RN 5.3)', () => {
    const plan = cardInstallments({
      card,
      totalAmount: 100000,
      installments: 10,
      startInstallment: 4,
      firstDate: '2026-07-01',
      currentDate: '2026-10-15',
    });
    expect(plan).toHaveLength(7);
    expect(plan[0]).toEqual({
      number: 4,
      amount: 10000,
      date: '2026-10-01',
      invoiceMonth: '2026-11',
    });
    expect(plan.at(-1)?.invoiceMonth).toBe('2027-05');
  });

  it('validates input', () => {
    const base = { card, installments: 3, firstDate: '2026-10-02' };
    expect(() => cardInstallments(base)).toThrow(RangeError);
    expect(() => cardInstallments({ ...base, totalAmount: 1, installmentAmount: 1 })).toThrow(
      RangeError,
    );
    expect(() => cardInstallments({ ...base, totalAmount: 100, installments: 0 })).toThrow(
      RangeError,
    );
    expect(() => cardInstallments({ ...base, totalAmount: 100, startInstallment: 2 })).toThrow(
      RangeError,
    );
    expect(() => cardInstallments({ ...base, totalAmount: 100, startInstallment: 4 })).toThrow(
      RangeError,
    );
  });
});

describe('accountInstallments (RN 5.2)', () => {
  it('due dates monthly with business day adjust', () => {
    const plan = accountInstallments({
      totalAmount: 30000,
      installments: 3,
      firstDueDate: '2026-09-07',
      adjust: 'next',
      holidays: nationalHolidayDates(2026),
    });
    expect(plan).toEqual([
      { number: 1, amount: 10000, date: '2026-09-08' },
      { number: 2, amount: 10000, date: '2026-10-07' },
      { number: 3, amount: 10000, date: '2026-11-09' }, // 07/11 sábado
    ]);
  });

  it('requires holidays to adjust', () => {
    expect(() =>
      accountInstallments({
        totalAmount: 100,
        installments: 1,
        firstDueDate: '2026-09-07',
        adjust: 'next',
      }),
    ).toThrow(RangeError);
  });
});

const plan10: PlannedInstallment[] = Array.from({ length: 10 }, (_, i) => ({
  number: i + 1,
  amount: 10000,
  invoiceMonth: `2026-${String(i + 1).padStart(2, '0')}`,
  invoiceStatus: i < 7 ? 'paid' : i === 7 ? 'closed' : i === 8 ? 'open' : 'future',
}));

describe('cancelPlan (RN 5.4)', () => {
  it('cancels open/future and refunds billed if the bank returns', () => {
    const notPaid = plan10.slice(7);
    expect(cancelPlan(notPaid, { refundBilled: true })).toEqual({
      cancel: [9, 10],
      refundAmount: 10000,
    });
    expect(cancelPlan(notPaid, { refundBilled: false })).toEqual({
      cancel: [9, 10],
      refundAmount: 0,
    });
  });
});

describe('anticipateInstallments (RN 5.5)', () => {
  const plan: PlannedInstallment[] = [1, 2, 3, 4, 5, 6].map((n) => ({
    number: n,
    amount: 10000,
    invoiceMonth: addYearMonths('2026-10', n - 1),
    invoiceStatus: n === 1 ? 'open' : 'future',
  }));

  it('moves the last K installments to the open invoice', () => {
    const r = anticipateInstallments(plan, 2, '2026-10');
    expect(r.moved).toEqual([
      { number: 5, fromMonth: '2027-02', months: 4 },
      { number: 6, fromMonth: '2027-03', months: 5 },
    ]);
    expect(r.discount).toBe(0);
  });

  it('computes the present value discount from a monthly rate (floored)', () => {
    const r = anticipateInstallments(plan, 2, '2026-10', { monthlyRate: 0.02 });
    // 10000 - 10000/1.02^4 = 761.5... ; 10000 - 10000/1.02^5 = 942.69... → 1704
    expect(r.discount).toBe(1704);
  });

  it('accepts a fixed discount and validates count', () => {
    expect(anticipateInstallments(plan, 1, '2026-10', { amount: 500 }).discount).toBe(500);
    expect(() => anticipateInstallments(plan, 6, '2026-10')).toThrow(RangeError);
    expect(() => anticipateInstallments(plan, 1, '2026-10', { amount: 20000 })).toThrow(RangeError);
  });
});

describe('planSummary (RN 5.6)', () => {
  it('counts paid installments by invoice status', () => {
    expect(planSummary(plan10)).toEqual({
      paidCount: 7,
      remainingCount: 3,
      paidAmount: 70000,
      remainingAmount: 30000,
      progressByAmount: 0.7,
      progressByCount: 0.7,
    });
    expect(planSummary([]).progressByCount).toBe(0);
  });
});
