import type { Category } from '@finapp/shared';

const KEY = 'finapp.categoryUsage';

/** Ordem inicial (antes de haver uso): as mais comuns no dia a dia primeiro. */
const COMMON = [
  'Alimentação',
  'Mercado',
  'Transporte',
  'Moradia',
  'Contas da casa',
  'Saúde',
  'Lazer',
  'Compras',
  'Salário',
  'Freelance',
  'Reembolsos',
  'Rendimentos',
];

function read(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, number>;
  } catch {
    return {};
  }
}

/** Conta um uso da categoria neste aparelho ("mais usadas primeiro"). */
export function countCategoryUse(id: string) {
  const usage = read();
  usage[id] = (usage[id] ?? 0) + 1;
  try {
    localStorage.setItem(KEY, JSON.stringify(usage));
  } catch {
    // ignora
  }
}

export function sortByUsage(categories: Category[]): Category[] {
  const usage = read();
  const rank = (c: Category) => {
    const i = COMMON.indexOf(c.name);
    return i === -1 ? COMMON.length : i;
  };
  return [...categories].sort(
    (a, b) =>
      (usage[b.id] ?? 0) - (usage[a.id] ?? 0) ||
      rank(a) - rank(b) ||
      a.name.localeCompare(b.name, 'pt-BR'),
  );
}
