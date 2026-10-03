import { describe, expect, it } from 'vitest';
import { balanceImpact, cashVsInstallments, impliedMonthlyRate, installmentOffer } from './index';

describe('installmentOffer', () => {
  it('without interest splits the price', () => {
    expect(installmentOffer({ price: 120000, installments: 12, monthlyRate: 0 })).toMatchObject({
      installmentAmount: 10000,
      total: 120000,
      interest: 0,
      monthlyRate: 0,
    });
  });

  it('with a monthly rate uses the Price payment', () => {
    // 1.000,00 em 12x a 2% a.m.: parcela de 94,56 (Price).
    const o = installmentOffer({ price: 100000, installments: 12, monthlyRate: 0.02 });
    expect(o.installmentAmount).toBe(9456);
    expect(o.total).toBe(113472);
    expect(o.interest).toBe(13472);
  });

  it('finds the rate hidden in a given installment', () => {
    const o = installmentOffer({ price: 100000, installments: 12, installmentAmount: 9456 });
    expect(o.monthlyRate).toBeCloseTo(0.02, 4);
    expect(o.interest).toBe(13472);
  });

  it('rejects ambiguous or invalid input', () => {
    expect(() => installmentOffer({ price: 1000, installments: 3 })).toThrow();
    expect(() =>
      installmentOffer({ price: 1000, installments: 3, monthlyRate: 0.01, installmentAmount: 400 }),
    ).toThrow();
    expect(() => installmentOffer({ price: 0, installments: 3, monthlyRate: 0 })).toThrow();
  });
});

describe('impliedMonthlyRate', () => {
  it('is zero when the installments do not exceed the price', () => {
    expect(impliedMonthlyRate(100000, 10000, 10)).toBe(0);
    expect(impliedMonthlyRate(100000, 8000, 10)).toBe(0);
  });
});

describe('cashVsInstallments', () => {
  it('interest-free installments beat cash when money earns interest', () => {
    // 12x de 100,00 sem juros contra 1.150,00 à vista, dinheiro rendendo 1% ao mês.
    const r = cashVsInstallments({
      cashPrice: 115000,
      installmentAmount: 10000,
      installments: 12,
      opportunityRate: 0.01,
    });
    expect(r.presentValue).toBe(112551);
    expect(r.cheaper).toBe('installments');
    expect(r.difference).toBe(112551 - 115000);
  });

  it('cash wins with a good discount, and reports the break-even discount', () => {
    const r = cashVsInstallments({
      cashPrice: 100000,
      installmentAmount: 10000,
      installments: 12,
      opportunityRate: 0.01,
    });
    expect(r.cheaper).toBe('cash');
    expect(r.breakEvenDiscount).toBeCloseTo(1 - 112551 / 120000, 4);
  });

  it('zero opportunity rate compares the nominal total', () => {
    const r = cashVsInstallments({
      cashPrice: 120000,
      installmentAmount: 10000,
      installments: 12,
      opportunityRate: 0,
    });
    expect(r.cheaper).toBe('tie');
  });
});

describe('balanceImpact', () => {
  const forecast = [
    { month: '2026-10', closingBalance: 50000 },
    { month: '2026-11', closingBalance: 30000 },
    { month: '2026-12', closingBalance: 20000 },
  ];

  it('accumulates outflows into the following months', () => {
    const r = balanceImpact(forecast, [
      { month: '2026-11', amount: 25000 },
      { month: '2026-12', amount: 25000 },
    ]);
    expect(r.months.map((m) => m.after)).toEqual([50000, 5000, -30000]);
    expect(r.lowest).toEqual({ month: '2026-12', balance: -30000 });
    expect(r.firstNewNegative).toBe('2026-12');
  });

  it('does not blame the purchase for months that were already negative', () => {
    const r = balanceImpact(
      [{ month: '2026-10', closingBalance: -100 }],
      [{ month: '2026-10', amount: 50 }],
    );
    expect(r.firstNewNegative).toBeNull();
  });

  it('handles no forecast', () => {
    expect(balanceImpact([], [])).toEqual({ months: [], lowest: null, firstNewNegative: null });
  });
});
