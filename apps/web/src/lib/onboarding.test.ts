import { describe, expect, it } from 'vitest';
import { onboardingSteps, showOnboarding } from './onboarding';

const none = {
  account: false,
  card: false,
  income: false,
  expenses: false,
  debts: false,
  notifications: false,
};

describe('onboardingSteps', () => {
  it('marks steps done by data, skipped by the user, the rest to do', () => {
    const state = { dismissed: false, skipped: ['card' as const, 'account' as const] };
    const steps = onboardingSteps({ ...none, account: true }, state);
    expect(steps.map((s) => [s.step, s.status])).toEqual([
      ['account', 'done'],
      ['card', 'skipped'],
      ['income', 'todo'],
      ['expenses', 'todo'],
      ['debts', 'todo'],
      ['notifications', 'todo'],
    ]);
    // A conta é obrigatória: não tem "pular".
    expect(steps[0]?.skipLabel).toBeUndefined();
    expect(steps[1]?.skipLabel).toBe('Não uso cartão');
  });

  it('shows the card until everything is done or skipped, unless dismissed', () => {
    const open = { dismissed: false, skipped: [] };
    expect(showOnboarding(onboardingSteps(none, open), open)).toBe(true);
    const all = Object.fromEntries(Object.keys(none).map((k) => [k, true])) as typeof none;
    expect(showOnboarding(onboardingSteps(all, open), open)).toBe(false);
    const skippedRest = { dismissed: false, skipped: ['debts' as const, 'notifications' as const] };
    expect(
      showOnboarding(
        onboardingSteps({ ...all, debts: false, notifications: false }, skippedRest),
        skippedRest,
      ),
    ).toBe(false);
    const hidden = { dismissed: true, skipped: [] };
    expect(showOnboarding(onboardingSteps(none, hidden), hidden)).toBe(false);
  });
});
