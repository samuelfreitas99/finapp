import { formatBRL, type Cents } from '../money';

/**
 * Resumos semanal e mensal enviados por push: texto curto com o que entrou, o que saiu, o
 * maior gasto e o que vence nos próximos dias. Função pura.
 */

export interface SummaryInput {
  kind: 'weekly' | 'monthly';
  /** Ex.: "setembro" (mensal) ou "21/09 a 27/09" (semanal). */
  periodLabel: string;
  income: Cents;
  expense: Cents;
  /** Despesas do período anterior equivalente, para comparar (nulo se não houver). */
  previousExpense: Cents | null;
  /** Maiores categorias de despesa, em ordem decrescente. */
  topCategories: readonly { name: string; amount: Cents }[];
  /** Vencimentos dos próximos 7 dias (só no resumo semanal). */
  upcoming?: { count: number; total: Cents };
}

export interface Summary {
  title: string;
  body: string;
  url: string;
}

/** Variação percentual inteira de `now` sobre `before`; nula se não dá para comparar. */
export function percentChange(now: Cents, before: Cents | null): number | null {
  if (before === null || before <= 0) return null;
  return Math.round(((now - before) / before) * 100);
}

export function buildSummary(input: SummaryInput): Summary {
  const { kind, periodLabel, income, expense } = input;
  const parts: string[] = [`Entrou ${formatBRL(income)}, saiu ${formatBRL(expense)}.`];
  const top = input.topCategories[0];
  if (top && top.amount > 0) parts.push(`Maior gasto: ${top.name} (${formatBRL(top.amount)}).`);
  const change = percentChange(expense, input.previousExpense);
  if (change !== null && change !== 0) {
    const base = kind === 'weekly' ? 'à semana anterior' : 'ao mês anterior';
    parts.push(
      `Gastou ${Math.abs(change)}% ${change > 0 ? 'a mais' : 'a menos'} em relação ${base}.`,
    );
  }
  if (input.upcoming && input.upcoming.count > 0) {
    const n = input.upcoming.count;
    parts.push(
      `Nos próximos 7 dias: ${n} ${n === 1 ? 'vencimento' : 'vencimentos'} (${formatBRL(input.upcoming.total)}).`,
    );
  }
  const net = income - expense;
  const title =
    kind === 'monthly'
      ? net >= 0
        ? `Resumo de ${periodLabel}: sobraram ${formatBRL(net)}`
        : `Resumo de ${periodLabel}: faltaram ${formatBRL(-net)}`
      : `Sua semana (${periodLabel}): gastou ${formatBRL(expense)}`;
  return {
    title,
    body: parts.join(' '),
    url: kind === 'monthly' ? '/relatorios' : '/lancamentos',
  };
}

const MONTHS = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
] as const;

/** Nome do mês (`YYYY-MM` → "setembro de 2026"). */
export function monthName(ym: string): string {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  return `${MONTHS[m - 1]} de ${y}`;
}

/** Dia da semana de uma data ISO: 0 = domingo ... 6 = sábado. */
export function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** Semana ISO `YYYY-Www` (para a chave de idempotência do resumo semanal). */
export function isoWeekKey(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
