import type { OnboardingStep } from '@finapp/shared';
import { Check, Circle, Minus } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useMe, useUpdateOnboarding } from '../auth/session';
import { onboardingSteps, showOnboarding } from '../lib/onboarding';
import { pushSupported } from '../lib/push';
import { useCards, useDebts, useRecurrences } from '../lib/queries';

/** Este aparelho já recebe notificações? (`null` enquanto confere). */
function usePushOn(): boolean | null {
  const [on, setOn] = useState<boolean | null>(pushSupported() ? null : false);
  useEffect(() => {
    if (!pushSupported()) return;
    let alive = true;
    // `getRegistration` não fica esperando um service worker que ainda não existe.
    navigator.serviceWorker
      .getRegistration()
      .then((reg) => reg?.pushManager.getSubscription() ?? null)
      .then((sub) => alive && setOn(Boolean(sub)))
      .catch(() => alive && setOn(false));
    return () => {
      alive = false;
    };
  }, []);
  return on;
}

/**
 * "Primeiros passos" no Início: o que cadastrar para o app prever o mês. Cada passo se
 * marca sozinho quando o dado existe; os opcionais podem ser pulados. Some quando tudo
 * estiver feito ou pulado, ou quando a pessoa esconde.
 */
export function OnboardingCard({
  hasAccounts,
  fallback = null,
}: {
  hasAccounts: boolean;
  /** O que mostrar quando os primeiros passos estão escondidos ou concluídos. */
  fallback?: ReactNode;
}) {
  const { data: me } = useMe();
  const cards = useCards();
  const recurrences = useRecurrences();
  const debts = useDebts();
  const pushOn = usePushOn();
  const update = useUpdateOnboarding();
  const loading = cards.isPending || recurrences.isPending || debts.isPending || pushOn === null;
  if (!me || loading) return null;

  const recs = recurrences.data ?? [];
  const steps = onboardingSteps(
    {
      account: hasAccounts,
      card: (cards.data ?? []).length > 0,
      income: recs.some((r) => r.type === 'income'),
      expenses: recs.some((r) => r.type === 'expense'),
      debts: (debts.data ?? []).length > 0,
      notifications: pushOn,
    },
    me.onboarding,
  );
  if (!showOnboarding(steps, me.onboarding)) return <>{fallback}</>;

  const finished = steps.filter((s) => s.status !== 'todo').length;
  const current = steps.find((s) => s.status === 'todo');
  const skip = (step: OnboardingStep) =>
    update.mutate({ skipped: [...me.onboarding.skipped, step] });

  return (
    <section className="card card--pad onboarding" aria-labelledby="onboarding-title">
      <div className="section-head">
        <h2 id="onboarding-title">Primeiros passos</h2>
        <span className="muted num">
          {finished} de {steps.length}
        </span>
      </div>
      <span
        className="progress"
        role="progressbar"
        aria-label="Primeiros passos concluídos"
        aria-valuemin={0}
        aria-valuemax={steps.length}
        aria-valuenow={finished}
      >
        <span style={{ width: `${(finished / steps.length) * 100}%` }} />
      </span>
      <ol className="onboarding__steps">
        {steps.map((s) => {
          const isCurrent = s === current;
          const Icon = s.status === 'done' ? Check : s.status === 'skipped' ? Minus : Circle;
          return (
            <li
              key={s.step}
              className={`onboarding__step onboarding__step--${s.status}${isCurrent ? ' onboarding__step--current' : ''}`}
            >
              <span className="onboarding__mark" aria-hidden="true">
                <Icon size={14} strokeWidth={3} />
              </span>
              <div className="onboarding__body">
                <span className="onboarding__title">
                  {s.title}
                  <span className="sr-only">
                    {s.status === 'done' ? ' (feito)' : s.status === 'skipped' ? ' (pulado)' : ''}
                  </span>
                </span>
                {isCurrent && (
                  <>
                    <span className="muted">
                      {s.step === 'notifications' && !pushSupported()
                        ? 'No iPhone, instale o app antes (Compartilhar › Adicionar à Tela de Início) e abra por ele.'
                        : s.hint}
                    </span>
                    <div className="onboarding__actions">
                      <Link to={s.to} className="btn btn--primary">
                        {s.action}
                      </Link>
                      {s.skipLabel && (
                        <button
                          type="button"
                          className="btn btn--ghost"
                          disabled={update.isPending}
                          onClick={() => skip(s.step)}
                        >
                          {s.skipLabel}
                        </button>
                      )}
                    </div>
                  </>
                )}
                {!isCurrent && s.status === 'todo' && (
                  <Link to={s.to} className="onboarding__later">
                    {s.action}
                  </Link>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      <button
        type="button"
        className="btn btn--ghost onboarding__hide"
        disabled={update.isPending}
        onClick={() => update.mutate({ dismissed: true })}
      >
        Esconder primeiros passos
      </button>
    </section>
  );
}
