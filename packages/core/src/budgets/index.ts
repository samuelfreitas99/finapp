import type { Cents } from '../money';
import { formatBRL } from '../money';

/**
 * Orçamentos (RN 8): limite mensal por categoria, consumo, sobra acumulada e alertas.
 * @see RN 8
 */

export const BUDGET_WARN_RATIO = 0.8;

export type BudgetLevel = 'ok' | 'warning' | 'exceeded';

export interface BudgetMonth {
  /** Limite cadastrado para o mês. */
  limit: Cents;
  /** Despesas efetivadas da categoria no mês (cartão pela fatura, estornos já descontados). */
  spent: Cents;
}

export interface BudgetProgress {
  limit: Cents;
  /** Sobra do mês anterior somada ao limite (só com `rollover`). */
  carry: Cents;
  /** `limit + carry`. */
  available: Cents;
  spent: Cents;
  /** `available - spent` (negativo = estourou). */
  remaining: Cents;
  /** `spent / available`, sem teto (1,25 = 125%); 0 se não há limite. */
  ratio: number;
  level: BudgetLevel;
}

/** Faixa do consumo: 80% avisa, 100% estourou. Com limite 0 qualquer gasto estoura. */
export function budgetLevel(spent: Cents, available: Cents): BudgetLevel {
  if (spent <= 0) return 'ok';
  if (available <= 0 || spent >= available) return 'exceeded';
  return spent >= available * BUDGET_WARN_RATIO ? 'warning' : 'ok';
}

/** Situação de um mês, dado o limite, o gasto e a sobra trazida do mês anterior. */
export function budgetProgress(month: BudgetMonth, carry: Cents = 0): BudgetProgress {
  const available = month.limit + carry;
  return {
    limit: month.limit,
    carry,
    available,
    spent: month.spent,
    remaining: available - month.spent,
    ratio: available > 0 ? month.spent / available : 0,
    level: budgetLevel(month.spent, available),
  };
}

/**
 * Sobra acumulada (rollover): a cada mês, o que não foi gasto (limite + sobra - gasto, se
 * positivo) vira crédito no seguinte. Estouro não vira dívida: a sobra volta a zero.
 * `months` em ordem cronológica; devolve a sobra que entra no mês **seguinte** ao último.
 */
export function rolloverCarry(months: readonly BudgetMonth[]): Cents {
  let carry = 0;
  for (const m of months) carry = Math.max(0, m.limit + carry - m.spent);
  return carry;
}

export interface BudgetAlertInput {
  categoryId: string;
  categoryName: string;
  /** `YYYY-MM` do mês do orçamento. */
  month: string;
  progress: BudgetProgress;
}

export interface BudgetAlert {
  level: 'warning' | 'exceeded';
  dedupeKey: string;
  title: string;
  body: string;
  url: string;
  categoryId: string;
}

/** Alertas de 80% e 100%: um por categoria, mês e faixa (idempotente pela chave). */
export function buildBudgetAlerts(items: readonly BudgetAlertInput[]): BudgetAlert[] {
  const alerts: BudgetAlert[] = [];
  for (const { categoryId, categoryName, month, progress: p } of items) {
    if (p.level === 'ok') continue;
    const pct = Math.floor(p.ratio * 100);
    alerts.push(
      p.level === 'exceeded'
        ? {
            level: 'exceeded',
            dedupeKey: `budget:${categoryId}:${month}:exceeded`,
            title: `Orçamento de ${categoryName} estourou`,
            body:
              p.remaining < 0
                ? `Gasto ${formatBRL(p.spent)} de ${formatBRL(p.available)} (${formatBRL(-p.remaining)} acima).`
                : `Gasto ${formatBRL(p.spent)} de ${formatBRL(p.available)}.`,
            url: `/orcamentos?mes=${month}`,
            categoryId,
          }
        : {
            level: 'warning',
            dedupeKey: `budget:${categoryId}:${month}:warning`,
            title: `Orçamento de ${categoryName}: ${pct}% usado`,
            body: `Gasto ${formatBRL(p.spent)} de ${formatBRL(p.available)}. Restam ${formatBRL(p.remaining)}.`,
            url: `/orcamentos?mes=${month}`,
            categoryId,
          },
    );
  }
  return alerts;
}
