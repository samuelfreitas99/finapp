import { useState } from 'react';
import { PageHeader } from '../../components/PageHeader';
import { useInstallmentPlans } from '../../lib/queries';
import { PlanList } from './PlanList';

const TABS = [
  { value: 'active', label: 'Ativos' },
  { value: 'finished', label: 'Quitados' },
  { value: 'cancelled', label: 'Cancelados' },
] as const;

/** Todos os parcelamentos: no cartão e carnês/boletos nas contas (RN 5.6). */
export function PlansPage() {
  const [status, setStatus] = useState<(typeof TABS)[number]['value']>('active');
  const plans = useInstallmentPlans({ status });
  return (
    <>
      <PageHeader title="Parcelamentos" />
      <div className="segmented" role="group" aria-label="Situação">
        {TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            aria-pressed={status === t.value}
            onClick={() => setStatus(t.value)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <PlanList plans={plans.data} pending={plans.isPending} />
    </>
  );
}
