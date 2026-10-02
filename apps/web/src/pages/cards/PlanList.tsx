import type { InstallmentPlan } from '@finapp/shared';
import { ChevronRight, Layers } from 'lucide-react';
import { Link } from 'react-router';
import { formatDate, money } from '../../lib/format';
import { useHiddenValues } from '../../lib/hidden-values';
import { monthLabel } from '../../lib/dates';

/** Parcelamentos ativos com barra de progresso (RN 5.6). */
export function PlanList({
  plans,
  pending,
}: {
  plans: InstallmentPlan[] | undefined;
  pending: boolean;
}) {
  const { hidden } = useHiddenValues();
  if (pending) return <div className="skeleton" style={{ height: 200 }} />;
  if (!plans?.length) {
    return (
      <div className="card empty empty--compact">
        <Layers size={28} strokeWidth={1.5} aria-hidden="true" />
        <p className="muted">
          Nenhum parcelamento ativo. Use "Parcelar" no + ao lançar uma compra.
        </p>
      </div>
    );
  }
  return (
    <ul className="list card">
      {plans.map((p) => {
        const done = p.summary.paidCount + (p.startInstallment - 1);
        return (
          <li key={p.id}>
            <Link to={`/parcelamentos/${p.id}`} className="row-link plan-row">
              <span className="row-link__main">
                <span className="row-link__title">{p.description}</span>
                <span
                  className="progress"
                  role="progressbar"
                  aria-label={`${done} de ${p.installments} parcelas pagas`}
                  aria-valuemin={0}
                  aria-valuemax={p.installments}
                  aria-valuenow={done}
                >
                  <span style={{ width: `${(done / p.installments) * 100}%` }} />
                </span>
                <span className="row-link__meta">
                  {done} de {p.installments} pagas, faltam{' '}
                  {money(p.summary.remainingAmount, hidden)}
                  {p.next
                    ? `. Próxima: ${money(p.next.amount, hidden)} ${
                        p.next.invoiceMonth
                          ? `na fatura de ${monthLabel(p.next.invoiceMonth)}`
                          : `em ${formatDate(p.next.date)}`
                      }`
                    : ''}
                </span>
              </span>
              <ChevronRight size={18} aria-hidden="true" className="muted" />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
