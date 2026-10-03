import { ONBOARDING_STEPS, type Onboarding, type OnboardingStep } from '@finapp/shared';

export interface OnboardingStepView {
  step: OnboardingStep;
  title: string;
  hint: string;
  to: string;
  action: string;
  /** Texto do "não se aplica"; sem ele, o passo não pode ser pulado. */
  skipLabel?: string;
  status: 'done' | 'skipped' | 'todo';
}

const TEXT: Record<OnboardingStep, Omit<OnboardingStepView, 'step' | 'status'>> = {
  account: {
    title: 'Cadastre suas contas',
    hint: 'Onde seu dinheiro está (conta, carteira, VR), com o saldo de hoje.',
    to: '/contas/nova',
    action: 'Nova conta',
  },
  card: {
    title: 'Cadastre seus cartões de crédito',
    hint: 'Com o fechamento e o vencimento, o app monta as faturas.',
    to: '/cartoes/novo',
    action: 'Novo cartão',
    skipLabel: 'Não uso cartão',
  },
  income: {
    title: 'Cadastre seu salário',
    hint: 'Dá para dividir em adiantamento e restante, ou marcar que o valor muda todo mês.',
    to: '/fixas/nova?tipo=receita',
    action: 'Cadastrar salário',
    skipLabel: 'Não tenho renda fixa',
  },
  expenses: {
    title: 'Cadastre as contas fixas',
    hint: 'Aluguel, luz, internet, assinaturas: entram sozinhas todo mês.',
    to: '/fixas/nova',
    action: 'Nova conta fixa',
    skipLabel: 'Não tenho',
  },
  debts: {
    title: 'Cadastre empréstimos e financiamentos',
    hint: 'Com o que aparece no app do banco: quantas parcelas faltam e o valor.',
    to: '/dividas/nova',
    action: 'Nova dívida',
    skipLabel: 'Não tenho dívidas',
  },
  notifications: {
    title: 'Ligue os avisos neste aparelho',
    hint: 'Vencimentos, faturas e orçamento estourando chegam como notificação.',
    to: '/configuracoes',
    action: 'Ligar avisos',
    skipLabel: 'Agora não',
  },
};

/**
 * Situação de cada passo dos "primeiros passos": feito (pelo que já existe no espaço),
 * pulado pela pessoa ou a fazer.
 */
export function onboardingSteps(
  done: Record<OnboardingStep, boolean>,
  state: Onboarding,
): OnboardingStepView[] {
  return ONBOARDING_STEPS.map((step) => ({
    step,
    ...TEXT[step],
    status: done[step] ? 'done' : state.skipped.includes(step) ? 'skipped' : 'todo',
  }));
}

/** Mostra o cartão enquanto há passo a fazer e a pessoa não escondeu. */
export function showOnboarding(steps: OnboardingStepView[], state: Onboarding): boolean {
  return !state.dismissed && steps.some((s) => s.status === 'todo');
}
