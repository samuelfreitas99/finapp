import { describe, expect, it } from 'vitest';
import { buildSummary, isoWeekKey, monthName, percentChange, weekdayOf } from './index';

/** `formatBRL` usa espaço não separável depois do "R$". */
const plain = (text: string) => text.replace(/\u00a0/g, ' ');

describe('buildSummary', () => {
  it('writes the weekly summary with comparison and upcoming dues', () => {
    const s = buildSummary({
      kind: 'weekly',
      periodLabel: '21/09 a 27/09',
      income: 100000,
      expense: 45000,
      previousExpense: 30000,
      topCategories: [{ name: 'Mercado', amount: 20000 }],
      upcoming: { count: 3, total: 80000 },
    });
    expect(plain(s.title)).toBe('Sua semana (21/09 a 27/09): gastou R$ 450,00');
    expect(plain(s.body)).toBe(
      'Entrou R$ 1.000,00, saiu R$ 450,00. Maior gasto: Mercado (R$ 200,00). Gastou 50% a mais em relação à semana anterior. Nos próximos 7 dias: 3 vencimentos (R$ 800,00).',
    );
    expect(s.url).toBe('/lancamentos');
  });

  it('writes the monthly summary saying what was left or missing', () => {
    const left = buildSummary({
      kind: 'monthly',
      periodLabel: 'setembro de 2026',
      income: 500000,
      expense: 350000,
      previousExpense: 400000,
      topCategories: [],
    });
    expect(plain(left.title)).toBe('Resumo de setembro de 2026: sobraram R$ 1.500,00');
    expect(plain(left.body)).toContain('Gastou 12% a menos em relação ao mês anterior.');
    expect(left.url).toBe('/relatorios');
    const missing = buildSummary({
      kind: 'monthly',
      periodLabel: 'agosto de 2026',
      income: 100000,
      expense: 130000,
      previousExpense: null,
      topCategories: [],
    });
    expect(plain(missing.title)).toBe('Resumo de agosto de 2026: faltaram R$ 300,00');
    expect(missing.body).not.toContain('em relação');
  });

  it('uses the singular for one due date and skips an empty week', () => {
    const s = buildSummary({
      kind: 'weekly',
      periodLabel: 'x',
      income: 0,
      expense: 0,
      previousExpense: 0,
      topCategories: [],
      upcoming: { count: 1, total: 5000 },
    });
    expect(plain(s.body)).toContain('1 vencimento (R$ 50,00)');
    expect(
      plain(
        buildSummary({
          kind: 'weekly',
          periodLabel: 'x',
          income: 0,
          expense: 0,
          previousExpense: null,
          topCategories: [],
          upcoming: { count: 0, total: 0 },
        }).body,
      ),
    ).toBe('Entrou R$ 0,00, saiu R$ 0,00.');
  });
});

describe('helpers', () => {
  it('computes percent change', () => {
    expect(percentChange(150, 100)).toBe(50);
    expect(percentChange(50, 100)).toBe(-50);
    expect(percentChange(10, 0)).toBeNull();
    expect(percentChange(10, null)).toBeNull();
  });

  it('names months and weekdays', () => {
    expect(monthName('2026-09')).toBe('setembro de 2026');
    expect(weekdayOf('2026-10-05')).toBe(1); // segunda
    expect(weekdayOf('2026-10-04')).toBe(0); // domingo
  });

  it('gives the ISO week key', () => {
    expect(isoWeekKey('2026-10-05')).toBe('2026-W41');
    expect(isoWeekKey('2026-01-01')).toBe('2026-W01');
    expect(isoWeekKey('2025-12-29')).toBe('2026-W01');
  });
});
