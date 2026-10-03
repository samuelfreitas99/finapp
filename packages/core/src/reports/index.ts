import type { Cents } from '../money';

/**
 * Relatórios: agrupamento por categoria, taxa de poupança e patrimônio.
 * @see RN 8 (competência), RN 6 (dívidas)
 */

export interface CategoryAmount {
  id: string;
  name: string;
  amount: Cents;
}

export interface BreakdownItem extends CategoryAmount {
  /** Fatia do total (0 a 1). */
  share: number;
}

export interface Breakdown {
  total: Cents;
  items: BreakdownItem[];
}

export const OTHER_CATEGORY_ID = 'other';

/**
 * Ordena as categorias do maior para o menor valor e, com `top`, junta as demais em
 * "Outras". Só valores positivos entram (categoria com estorno maior que o gasto some).
 */
export function categoryBreakdown(rows: readonly CategoryAmount[], top?: number): Breakdown {
  const positive = rows
    .filter((r) => r.amount > 0)
    .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name, 'pt-BR'));
  const total = positive.reduce((s, r) => s + r.amount, 0);
  let kept = positive;
  if (top !== undefined && positive.length > top + 1) {
    const rest = positive.slice(top);
    kept = [
      ...positive.slice(0, top),
      { id: OTHER_CATEGORY_ID, name: 'Outras', amount: rest.reduce((s, r) => s + r.amount, 0) },
    ];
  }
  return {
    total,
    items: kept.map((r) => ({ ...r, share: total > 0 ? r.amount / total : 0 })),
  };
}

/** Quanto da renda sobrou: `(receitas − despesas) / receitas`; nulo sem receita. */
export function savingsRate(income: Cents, expense: Cents): number | null {
  return income > 0 ? (income - expense) / income : null;
}

export interface NetWorthLine {
  label: string;
  amount: Cents;
}

export interface NetWorth {
  assets: Cents;
  liabilities: Cents;
  net: Cents;
}

/** Patrimônio líquido = tudo o que tenho − tudo o que devo. Linhas negativas são ignoradas. */
export function netWorth(
  assets: readonly NetWorthLine[],
  liabilities: readonly NetWorthLine[],
): NetWorth {
  const sum = (lines: readonly NetWorthLine[]) =>
    lines.reduce((s, l) => s + Math.max(0, l.amount), 0);
  const a = sum(assets);
  const l = sum(liabilities);
  return { assets: a, liabilities: l, net: a - l };
}
