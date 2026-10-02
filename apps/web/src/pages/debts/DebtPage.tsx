import type { DebtInstallmentDto } from '@finapp/shared';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { PageHeader } from '../../components/PageHeader';
import { useToast } from '../../components/Toast';
import { DEBT_KIND_META, DEBT_SYSTEM_LABEL, INSTALLMENT_STATUS_LABEL } from '../../lib/debts';
import { formatDate, money } from '../../lib/format';
import { useHiddenValues } from '../../lib/hidden-values';
import { useDebt, useDebtMutations } from '../../lib/queries';
import { errorText } from '../transactions/EntryForm';
import { DebtExtraActions, PayInstallmentForm, PropertyActions } from './DebtActions';

const STATUS_PILL: Record<DebtInstallmentDto['status'], string> = {
  pending: 'pill',
  paid: 'pill pill--paid',
  late: 'pill pill--overdue',
  partial: 'pill pill--partial',
};

function Progress({
  value,
  label,
  large = false,
}: {
  value: number;
  label: string;
  large?: boolean;
}) {
  const pct = Math.round(value * 100);
  return (
    <span
      className={large ? 'progress progress--large' : 'progress'}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
    >
      <span style={{ width: `${pct}%` }} />
    </span>
  );
}

/** Painel e cronograma da dívida. @see RN 6.4, 6.7 */
export function DebtPage() {
  const { id = '' } = useParams();
  const debt = useDebt(id);
  const { cancel } = useDebtMutations();
  const navigate = useNavigate();
  const toast = useToast();
  const { hidden } = useHiddenValues();
  const [showAll, setShowAll] = useState(false);
  const [paying, setPaying] = useState<string | null>(null);

  if (debt.isPending) return <div className="skeleton" style={{ height: 480 }} />;
  if (debt.isError || !debt.data) {
    return (
      <>
        <PageHeader title="Dívida" back="/dividas" />
        <p className="alert alert--error" role="alert">
          {errorText(debt.error)}
        </p>
      </>
    );
  }
  const d = debt.data;
  const s = d.summary;
  const pct = Math.round(s.progressByAmount * 100);
  const phaseName = new Map(d.phases.map((p) => [p.id, p.name]));
  const pending = d.installments.filter((i) => i.status !== 'paid');
  const visible = showAll ? d.installments : pending.slice(0, 12);
  const owedToMe = d.direction === 'owed_to_me';

  return (
    <>
      <PageHeader title={d.name} back="/dividas" />
      <p className="muted">
        {DEBT_KIND_META[d.kind].label}
        {d.institution ? `, ${d.institution}` : ''}
        {d.status === 'cancelled' ? ', cancelada' : d.status === 'paid_off' ? ', quitada' : ''}
      </p>

      <section className="hero" aria-label="Resumo">
        <span className="hero__label">{owedToMe ? 'Falta receber' : 'Falta pagar'}</span>
        <strong className="hero__value num">{money(s.remainingAmount, hidden)}</strong>
        <span className="hero__label">
          {pct}% quitado, {s.paidCount} de {s.totalCount} parcelas
        </span>
        <span className="hero__bar" aria-hidden="true">
          <span style={{ width: `${pct}%` }} />
        </span>
        <div className="hero__split">
          <div>
            <span>{owedToMe ? 'Recebido' : 'Pago'}</span>
            <strong className="num">{money(s.paidAmount, hidden)}</strong>
          </div>
          <div>
            <span>Para quitar hoje</span>
            <strong className="num">{money(s.outstandingPrincipal, hidden)}</strong>
          </div>
        </div>
      </section>

      {s.lateCount > 0 && (
        <p className="alert" role="status">
          {s.lateCount} parcela(s) atrasada(s), {money(s.lateAmount, hidden)}.
        </p>
      )}

      <section className="card card--pad" aria-label="Números">
        <dl className="invoice-head__rows">
          {s.interestPaid + s.interestToPay > 0 && (
            <>
              <div>
                <dt>Juros já pagos</dt>
                <dd className="num">{money(s.interestPaid, hidden)}</dd>
              </div>
              <div>
                <dt>Juros a pagar</dt>
                <dd className="num">{money(s.interestToPay, hidden)}</dd>
              </div>
            </>
          )}
          {s.expectedPayoffDate && (
            <div>
              <dt>Última parcela</dt>
              <dd>{formatDate(s.expectedPayoffDate)}</dd>
            </div>
          )}
          {d.completionDate && (
            <div>
              <dt>Entrega das chaves</dt>
              <dd>{formatDate(d.completionDate)}</dd>
            </div>
          )}
          {d.assetValue !== null && (
            <>
              <div>
                <dt>Valor do imóvel</dt>
                <dd className="num">{money(d.assetValue, hidden)}</dd>
              </div>
              <div>
                <dt>Patrimônio (valor − saldo devedor)</dt>
                <dd className="num">{money(d.equity ?? 0, hidden)}</dd>
              </div>
            </>
          )}
        </dl>
      </section>

      {d.phases.length > 1 && (
        <section className="stack" aria-labelledby="phases-title">
          <h2 id="phases-title">Fases</h2>
          <ol className="list card timeline">
            {d.phases.map((p) => (
              <li key={p.id} className="row-link">
                <span className="row-link__main">
                  <span className="row-link__title">{p.name}</span>
                  <Progress
                    value={p.summary.progressByAmount}
                    label={`${p.name}: ${Math.round(p.summary.progressByAmount * 100)}% pago`}
                  />
                  <span className="row-link__meta">
                    {DEBT_SYSTEM_LABEL[p.system]}, {p.summary.paidCount} de {p.summary.totalCount}
                    {p.summary.expectedPayoffDate
                      ? `, até ${formatDate(p.summary.expectedPayoffDate)}`
                      : ''}
                  </span>
                </span>
                <span className="row-link__value">
                  <strong className="num">{money(p.summary.remainingAmount, hidden)}</strong>
                  <span className="row-link__meta">restante</span>
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}

      <section className="stack" aria-labelledby="schedule-title">
        <div className="section-head">
          <h2 id="schedule-title">{showAll ? 'Cronograma completo' : 'Próximas parcelas'}</h2>
          <button type="button" className="btn btn--ghost" onClick={() => setShowAll((v) => !v)}>
            {showAll ? 'Só as próximas' : 'Ver todas'}
          </button>
        </div>
        <ul className="list card">
          {visible.map((i) => (
            <li key={i.id} className="row-link">
              <span className="date-tile">
                <strong className="num">{i.number}</strong>
                <span>parc.</span>
              </span>
              <span className="row-link__main">
                <span className="row-link__title">
                  {formatDate(i.dueDate)}
                  {d.phases.length > 1 ? `, ${phaseName.get(i.phaseId)} ${i.phaseNumber}` : ''}
                </span>
                <span className="row-link__meta">
                  <span className={STATUS_PILL[i.status]}>
                    {INSTALLMENT_STATUS_LABEL[i.status]}
                  </span>
                  {i.estimated ? 'estimada' : ''}
                  {i.interestPart > 0 ? ` juros ${money(i.interestPart, hidden)}` : ''}
                </span>
              </span>
              <span className="row-link__value">
                <strong className="num">{money(i.amount, hidden)}</strong>
                {d.status === 'active' && i.status !== 'paid' && paying !== i.id && (
                  <button type="button" className="btn btn--ghost" onClick={() => setPaying(i.id)}>
                    {owedToMe ? 'Receber' : 'Pagar'}
                  </button>
                )}
              </span>
              {paying === i.id && (
                <div className="schedule-pay">
                  <PayInstallmentForm debtId={d.id} inst={i} onDone={() => setPaying(null)} />
                </div>
              )}
            </li>
          ))}
          {visible.length === 0 && (
            <li className="row-link">
              <span className="muted">Nenhuma parcela pendente.</span>
            </li>
          )}
        </ul>
      </section>

      {d.status === 'active' && d.kind === 'property' && <PropertyActions d={d} />}

      {d.status === 'active' && <DebtExtraActions d={d} />}

      {d.status === 'active' && (
        <section className="card card--pad form" aria-label="Cancelar">
          <button
            type="button"
            className="btn btn--danger"
            disabled={cancel.isPending}
            onClick={() => {
              if (
                !window.confirm(`Cancelar "${d.name}"? As parcelas não pagas saem do planejamento.`)
              )
                return;
              cancel.mutate(d.id, {
                onSuccess: () => {
                  toast({ text: 'Dívida cancelada.' });
                  navigate('/dividas');
                },
              });
            }}
          >
            Cancelar dívida
          </button>
          <span className="muted field-hint">
            Para cadastro errado ou acordo desfeito. Pagamentos feitos ficam no histórico.
          </span>
        </section>
      )}
    </>
  );
}
