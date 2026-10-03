import { describe, expect, it } from 'vitest';
import {
  availableLimit,
  bestPurchaseDay,
  carriedBalance,
  invoiceDates,
  invoiceForPurchase,
  invoicePeriod,
  invoiceStatus,
  nextBestPurchaseDate,
  type CardConfig,
  invoiceLedger,
} from './index';

const card3x10: CardConfig = { closingDay: 3, dueDay: 10 };
const card25x5: CardConfig = { closingDay: 25, dueDay: 5 };

describe('invoiceDates (RN 4)', () => {
  it('closing in the same month when due > closing', () => {
    expect(invoiceDates(card3x10, '2026-10')).toEqual({
      referenceMonth: '2026-10',
      closingDate: '2026-10-03',
      dueDate: '2026-10-10',
    });
  });

  it('closing in the previous month when due <= closing', () => {
    expect(invoiceDates(card25x5, '2026-11')).toEqual({
      referenceMonth: '2026-11',
      closingDate: '2026-10-25',
      dueDate: '2026-11-05',
    });
    expect(invoiceDates({ closingDay: 10, dueDay: 10 }, '2026-01').closingDate).toBe('2025-12-10');
  });

  it('clamps days', () => {
    expect(invoiceDates({ closingDay: 30, dueDay: 31 }, '2026-02')).toMatchObject({
      closingDate: '2026-02-28',
      dueDate: '2026-02-28',
    });
  });

  it('applies overrides', () => {
    const overrides = (ym: string) =>
      ym === '2026-10' ? { closingDate: '2026-10-05', dueDate: null } : undefined;
    expect(invoiceDates(card3x10, '2026-10', overrides)).toMatchObject({
      closingDate: '2026-10-05',
      dueDate: '2026-10-10',
    });
  });

  it('validates days', () => {
    expect(() => invoiceDates({ closingDay: 0, dueDay: 10 }, '2026-10')).toThrow(RangeError);
    expect(() => invoiceDates({ closingDay: 3, dueDay: 32 }, '2026-10')).toThrow(RangeError);
  });
});

describe('invoiceForPurchase (RN 4)', () => {
  it('RN example: closing 3, due 10, rule true', () => {
    expect(invoiceForPurchase(card3x10, '2026-10-02')).toBe('2026-10');
    expect(invoiceForPurchase(card3x10, '2026-10-03')).toBe('2026-11');
  });

  it('rule false keeps closing-day purchases in the current invoice', () => {
    const card = { ...card3x10, closingDayGoesToNext: false };
    expect(invoiceForPurchase(card, '2026-10-03')).toBe('2026-10');
    expect(invoiceForPurchase(card, '2026-10-04')).toBe('2026-11');
  });

  it('RN example: closing 25, due 5', () => {
    expect(invoiceForPurchase(card25x5, '2026-10-20')).toBe('2026-11');
    expect(invoiceForPurchase(card25x5, '2026-10-26')).toBe('2026-12');
    expect(invoiceForPurchase(card25x5, '2026-12-31')).toBe('2027-02'); // fechou 25/12 (fatura de jan)
  });

  it('respects a postponed closing override', () => {
    const overrides = (ym: string) =>
      ym === '2026-10' ? { closingDate: '2026-10-05' } : undefined;
    expect(invoiceForPurchase(card3x10, '2026-10-04', overrides)).toBe('2026-10');
    expect(invoiceForPurchase(card3x10, '2026-10-05', overrides)).toBe('2026-11');
  });

  it('every day falls into exactly one invoice period', () => {
    for (const card of [card3x10, card25x5, { closingDay: 31, dueDay: 8 }]) {
      for (let d = 1; d <= 31; d++) {
        const date = `2026-03-${String(d).padStart(2, '0')}`;
        const ref = invoiceForPurchase(card, date);
        const { start, end } = invoicePeriod(card, ref);
        expect(date >= start && date <= end).toBe(true);
      }
    }
  });
});

describe('best purchase day (RN 4)', () => {
  it('is the closing day with rule true, next day with false', () => {
    expect(bestPurchaseDay(card3x10)).toBe(3);
    expect(bestPurchaseDay({ ...card3x10, closingDayGoesToNext: false })).toBe(4);
    expect(bestPurchaseDay({ closingDay: 31, dueDay: 8, closingDayGoesToNext: false })).toBe(1);
  });

  it('finds the next best purchase date', () => {
    expect(nextBestPurchaseDate(card3x10, '2026-10-01')).toBe('2026-10-03');
    expect(nextBestPurchaseDate(card3x10, '2026-10-03')).toBe('2026-10-03');
    expect(nextBestPurchaseDate(card3x10, '2026-10-04')).toBe('2026-11-03');
    expect(nextBestPurchaseDate({ ...card25x5, closingDayGoesToNext: false }, '2026-10-20')).toBe(
      '2026-10-26',
    );
  });
});

describe('invoiceStatus (RN 4)', () => {
  const dates = { closingDate: '2026-10-03', dueDate: '2026-10-10' };
  it('walks through the states', () => {
    expect(invoiceStatus({ ...dates, total: 1000, paid: 0, today: '2026-10-02' })).toBe('open');
    expect(invoiceStatus({ ...dates, total: 1000, paid: 0, today: '2026-10-03' })).toBe('closed');
    expect(invoiceStatus({ ...dates, total: 1000, paid: 0, today: '2026-10-10' })).toBe('closed');
    // Vence sábado 10/10; segunda 12/10 é feriado: só fica vencida na quarta 14/10.
    expect(invoiceStatus({ ...dates, total: 1000, paid: 0, today: '2026-10-11' })).toBe('closed');
    expect(invoiceStatus({ ...dates, total: 1000, paid: 0, today: '2026-10-13' })).toBe('closed');
    expect(invoiceStatus({ ...dates, total: 1000, paid: 0, today: '2026-10-14' })).toBe('overdue');
    expect(invoiceStatus({ ...dates, total: 1000, paid: 400, today: '2026-10-11' })).toBe(
      'partial',
    );
    expect(invoiceStatus({ ...dates, total: 1000, paid: 1000, today: '2026-10-11' })).toBe('paid');
    expect(invoiceStatus({ ...dates, total: -500, paid: 0, today: '2026-10-05' })).toBe('paid');
  });

  it('carries the unpaid balance', () => {
    expect(carriedBalance(1000, 400)).toBe(600);
    expect(carriedBalance(1000, 1200)).toBe(0);
  });
});

describe('availableLimit (RN 4)', () => {
  it('limit - unpaid items + payments', () => {
    expect(availableLimit({ limit: 500000, unpaidItems: 120000, payments: 20000 })).toBe(400000);
    expect(availableLimit({ limit: 100000, unpaidItems: 150000, payments: 0 })).toBe(-50000);
    expect(() => availableLimit({ limit: 1.5, unpaidItems: 0, payments: 0 })).toThrow(RangeError);
  });
});

describe('invoiceLedger (RN 4)', () => {
  const inv = (
    referenceMonth: string,
    closingDate: string,
    dueDate: string,
    items: number,
    paid = 0,
  ) => ({
    referenceMonth,
    closingDate,
    dueDate,
    items,
    paid,
  });

  it('carries the remainder of a partial invoice to the next month after the due date', () => {
    const rows = invoiceLedger(
      [
        inv('2026-11', '2026-11-03', '2026-11-10', 50000),
        inv('2026-10', '2026-10-03', '2026-10-10', 100000, 40000),
      ],
      '2026-10-20',
    );
    expect(rows.map((r) => r.referenceMonth)).toEqual(['2026-10', '2026-11']);
    expect(rows[0]).toMatchObject({ status: 'partial', carried: 0, total: 100000, remaining: 0 });
    expect(rows[1]).toMatchObject({
      status: 'open',
      carried: 60000,
      total: 110000,
      remaining: 110000,
    });
  });

  it('keeps the remainder on the invoice before the due date and on overdue invoices', () => {
    const beforeDue = invoiceLedger(
      [
        inv('2026-10', '2026-10-03', '2026-10-10', 100000, 40000),
        inv('2026-11', '2026-11-03', '2026-11-10', 50000),
      ],
      '2026-10-08',
    );
    expect(beforeDue[0]).toMatchObject({ status: 'partial', remaining: 60000 });
    expect(beforeDue[1]?.carried).toBe(0);

    const overdue = invoiceLedger(
      [
        inv('2026-10', '2026-10-03', '2026-10-10', 100000),
        inv('2026-11', '2026-11-03', '2026-11-10', 50000),
      ],
      '2026-10-20',
    );
    expect(overdue[0]).toMatchObject({ status: 'overdue', remaining: 100000 });
    expect(overdue[1]?.carried).toBe(0);
  });

  it('chains carries and treats refunds above purchases as paid', () => {
    const rows = invoiceLedger(
      [
        inv('2026-09', '2026-09-03', '2026-09-10', 30000, 10000),
        inv('2026-10', '2026-10-03', '2026-10-10', 0, 5000),
        inv('2026-11', '2026-11-03', '2026-11-10', -2000),
      ],
      '2026-11-20',
    );
    expect(rows.map((r) => [r.carried, r.total, r.status])).toEqual([
      [0, 30000, 'partial'],
      [20000, 20000, 'partial'],
      [15000, 13000, 'overdue'],
    ]);
  });
});
