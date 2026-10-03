import { diffYearMonths, yearMonthOf, type ISODate } from '../dates';
import type { Cents } from '../money';

/**
 * Metas (RN 8): valor alvo, data alvo opcional e aporte sugerido por mês.
 * @see RN 8
 */

export type GoalStatus = 'done' | 'on_track' | 'overdue' | 'no_date';

export interface GoalInput {
  targetAmount: Cents;
  /** Quanto já foi guardado (saldo da conta vinculada ou valor marcado à mão). */
  saved: Cents;
  targetDate: ISODate | null;
  today: ISODate;
}

export interface GoalProgress {
  saved: Cents;
  /** O que falta (0 se já bateu a meta). */
  remaining: Cents;
  /** `saved / target`, limitado a 1. */
  ratio: number;
  /** Meses até a data alvo, contando o mês corrente (mínimo 1); nulo sem data. */
  monthsLeft: number | null;
  /** `ceil(falta / meses)`; sem data, nulo. Data vencida: tudo o que falta. */
  suggestedMonthly: Cents | null;
  status: GoalStatus;
}

/** Situação da meta e aporte mensal sugerido: `(alvo - guardado) / meses_restantes`. */
export function goalProgress(input: GoalInput): GoalProgress {
  const saved = Math.max(0, input.saved);
  const remaining = Math.max(0, input.targetAmount - saved);
  const ratio = input.targetAmount > 0 ? Math.min(1, saved / input.targetAmount) : 1;
  if (remaining === 0) {
    return { saved, remaining, ratio, monthsLeft: null, suggestedMonthly: 0, status: 'done' };
  }
  if (!input.targetDate) {
    return { saved, remaining, ratio, monthsLeft: null, suggestedMonthly: null, status: 'no_date' };
  }
  if (input.targetDate < input.today) {
    return {
      saved,
      remaining,
      ratio,
      monthsLeft: 0,
      suggestedMonthly: remaining,
      status: 'overdue',
    };
  }
  const monthsLeft = Math.max(
    1,
    diffYearMonths(yearMonthOf(input.today), yearMonthOf(input.targetDate)),
  );
  return {
    saved,
    remaining,
    ratio,
    monthsLeft,
    suggestedMonthly: Math.ceil(remaining / monthsLeft),
    status: 'on_track',
  };
}
