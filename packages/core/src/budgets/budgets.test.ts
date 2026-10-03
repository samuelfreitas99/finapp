import { describe, expect, it } from 'vitest';
import { budgetLevel, budgetProgress, buildBudgetAlerts, rolloverCarry } from './index';

describe('budgetLevel (RN 8)', () => {
  it('warns at 80% and exceeds at 100%', () => {
    expect(budgetLevel(79999, 100000)).toBe('ok');
    expect(budgetLevel(80000, 100000)).toBe('warning');
    expect(budgetLevel(99999, 100000)).toBe('warning');
    expect(budgetLevel(100000, 100000)).toBe('exceeded');
    expect(budgetLevel(150000, 100000)).toBe('exceeded');
  });

  it('handles no spending and zero limit', () => {
    expect(budgetLevel(0, 0)).toBe('ok');
    expect(budgetLevel(1, 0)).toBe('exceeded');
    expect(budgetLevel(-500, 100000)).toBe('ok');
  });
});

describe('budgetProgress', () => {
  it('computes remaining and ratio, with carry', () => {
    const p = budgetProgress({ limit: 100000, spent: 90000 }, 20000);
    expect(p).toMatchObject({ available: 120000, remaining: 30000, level: 'ok' });
    expect(p.ratio).toBeCloseTo(0.75);
  });

  it('goes negative when exceeded', () => {
    const p = budgetProgress({ limit: 50000, spent: 62500 });
    expect(p.remaining).toBe(-12500);
    expect(p.ratio).toBeCloseTo(1.25);
    expect(p.level).toBe('exceeded');
  });
});

describe('rolloverCarry', () => {
  it('accumulates leftovers month after month', () => {
    expect(rolloverCarry([])).toBe(0);
    expect(
      rolloverCarry([
        { limit: 100000, spent: 70000 }, // sobra 30000
        { limit: 100000, spent: 90000 }, // 30000 + 10000 = 40000
      ]),
    ).toBe(40000);
  });

  it('resets to zero after overspending, never carrying debt', () => {
    expect(
      rolloverCarry([
        { limit: 100000, spent: 50000 }, // 50000
        { limit: 100000, spent: 200000 }, // estouro: 0
        { limit: 100000, spent: 80000 }, // 20000
      ]),
    ).toBe(20000);
  });
});

describe('buildBudgetAlerts', () => {
  it('creates one alert per category, month and level', () => {
    const alerts = buildBudgetAlerts([
      {
        categoryId: 'c1',
        categoryName: 'Mercado',
        month: '2026-10',
        progress: budgetProgress({ limit: 100000, spent: 85000 }),
      },
      {
        categoryId: 'c2',
        categoryName: 'Lazer',
        month: '2026-10',
        progress: budgetProgress({ limit: 30000, spent: 35000 }),
      },
      {
        categoryId: 'c3',
        categoryName: 'Transporte',
        month: '2026-10',
        progress: budgetProgress({ limit: 30000, spent: 1000 }),
      },
    ]);
    expect(alerts.map((a) => a.dedupeKey)).toEqual([
      'budget:c1:2026-10:warning',
      'budget:c2:2026-10:exceeded',
    ]);
    expect(alerts[0]?.title).toBe('Orçamento de Mercado: 85% usado');
    expect(alerts[1]?.title).toBe('Orçamento de Lazer estourou');
  });
});
