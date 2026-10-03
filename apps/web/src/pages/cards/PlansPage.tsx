import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
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
      <PageHeader
        title="Parcelamentos"
        back="/mais"
        action={
          <Link to="/lancar?parcelado=andamento" className="btn btn--primary">
            <Plus size={18} aria-hidden="true" />
            Já estou pagando
          </Link>
        }
      />
      <p className="muted">
        Compra nova parcelada: use o + e toque em &quot;Parcelar&quot;. Compra antiga que você ainda
        está pagando: toque em &quot;Já estou pagando&quot; e informe em qual parcela está.
      </p>
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
