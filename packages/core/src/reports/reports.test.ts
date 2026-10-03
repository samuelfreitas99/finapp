import { describe, expect, it } from 'vitest';
import { categoryBreakdown, netWorth, savingsRate } from './index';

describe('categoryBreakdown', () => {
  const rows = [
    { id: 'a', name: 'Mercado', amount: 50000 },
    { id: 'b', name: 'Lazer', amount: 30000 },
    { id: 'c', name: 'Transporte', amount: 15000 },
    { id: 'd', name: 'Saúde', amount: 5000 },
    { id: 'e', name: 'Zerada', amount: 0 },
    { id: 'f', name: 'Estornada', amount: -2000 },
  ];

  it('sorts descending with shares and drops non-positive rows', () => {
    const r = categoryBreakdown(rows);
    expect(r.total).toBe(100000);
    expect(r.items.map((i) => i.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(r.items[0]?.share).toBeCloseTo(0.5);
  });

  it('groups the tail into "Outras"', () => {
    const r = categoryBreakdown(rows, 2);
    expect(r.items.map((i) => [i.name, i.amount])).toEqual([
      ['Mercado', 50000],
      ['Lazer', 30000],
      ['Outras', 20000],
    ]);
  });

  it('keeps everything when the tail is a single row', () => {
    expect(categoryBreakdown(rows, 3).items).toHaveLength(4);
  });

  it('handles empty input', () => {
    expect(categoryBreakdown([])).toEqual({ total: 0, items: [] });
  });
});

describe('savingsRate', () => {
  it('is the share of income left, null without income', () => {
    expect(savingsRate(500000, 400000)).toBeCloseTo(0.2);
    expect(savingsRate(100000, 130000)).toBeCloseTo(-0.3);
    expect(savingsRate(0, 1000)).toBeNull();
  });
});

describe('netWorth', () => {
  it('subtracts liabilities from assets', () => {
    expect(
      netWorth(
        [
          { label: 'Contas', amount: 800000 },
          { label: 'Imóvel', amount: 30000000 },
        ],
        [
          { label: 'Cartões', amount: 120000 },
          { label: 'Financiamento', amount: 20000000 },
          { label: 'Ruído', amount: -5 },
        ],
      ),
    ).toEqual({ assets: 30800000, liabilities: 20120000, net: 10680000 });
  });
});
