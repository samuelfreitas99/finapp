import type { DebtDetail, DebtInstallmentDto } from '@finapp/shared';
import {
  Building2,
  Calculator,
  CircleCheckBig,
  FastForward,
  Pencil,
  TrendingDown,
  type LucideIcon,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { PageHeader } from '../../components/PageHeader';
import { useToast } from '../../components/Toast';
import { DEBT_KIND_META, DEBT_SYSTEM_LABEL, INSTALLMENT_STATUS_LABEL } from '../../lib/debts';
import { formatDate, money } from '../../lib/format';
import { useHiddenValues } from '../../lib/hidden-values';
import { useDebt, useDebtMutations } from '../../lib/queries';
import { errorText } from '../transactions/EntryForm';
import {
  AdvanceForm,
  AmortizeForm,
  EditDebtForm,
  PayInstallmentForm,
  PayoffForm,
  PropertyActions,
} from './DebtActions';

type Panel = 'pay' | 'advance' | 'amortize' | 'payoff' | 'property' | 'edit';

/**
 * Ações da dívida logo abaixo do resumo: "Pagar parcela" em destaque e as demais numa
 * grade; cada uma abre o formulário ali mesmo (uma por vez).
 */
function DebtActionPanel({
  d,
  panel,
  setPanel,
}: {
  d: DebtDetail;
  panel: Panel | null;
  setPanel: (p: Panel | null) => void;
}) {
  const owedToMe = d.direction === 'owed_to_me';
  const next = d.installments
    .filter((i) => i.status !== 'paid')
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
  const close = () => setPanel(null);
  const toggle = (p: Panel) => setPanel(panel === p ? null : p);
  const action = (p: Panel, label: string, Icon: LucideIcon) => (
    <button type="button" className="choice" aria-pressed={panel === p} onClick={() => toggle(p)}>
      <Icon size={20} aria-hidden="true" />
      {label}
    </button>
  );
  const forms: Record<Panel, { title: string; body: ReactNode }> = {
    pay: {
      title: next ? `Parcela ${next.number}, vence em ${formatDate(next.dueDate)}` : '',
      body: next ? (
        <PayInstallmentForm debtId={d.id} inst={next} owedToMe={owedToMe} onDone={close} />
      ) : null,
    },
    advance: {
      title: owedToMe ? 'Receber parcelas adiantadas' : 'Adiantar parcelas',
      body: <AdvanceForm d={d} onDone={close} />,
    },
    amortize: { title: 'Amortizar', body: <AmortizeForm d={d} onDone={close} /> },
    payoff: {
      title: owedToMe ? 'Receber tudo' : 'Quitar a dívida',
      body: <PayoffForm d={d} onDone={close} />,
    },
    property: { title: 'Imóvel', body: <PropertyActions d={d} /> },
    edit: { title: 'Editar dados', body: <EditDebtForm d={d} onDone={close} /> },
  };
  const open = panel ? forms[panel] : null;

  return (
    <section className="stack" aria-label="Ações">
      {next && panel !== 'pay' && (
        <button
          type="button"
          className="btn btn--primary btn--block"
          onClick={() => setPanel('pay')}
        >
          {owedToMe ? 'Receber' : 'Pagar'} parcela {next.number}:{' '}
          {money(next.amount - next.paidAmount - next.discount)}
          {next.status === 'late' ? ' (atrasada)' : ` em ${formatDate(next.dueDate)}`}
        </button>
      )}
      <div className="choice-grid">
        {action('advance', owedToMe ? 'Receber adiantado' : 'Adiantar', FastForward)}
        {!owedToMe && action('amortize', 'Amortizar', TrendingDown)}
        {action('payoff', owedToMe ? 'Receber tudo' : 'Quitar', CircleCheckBig)}
        {!owedToMe && (
          <Link className="choice" to={`/simuladores?divida=${d.id}`}>
            <Calculator size={20} aria-hidden="true" />
            Simular
          </Link>
        )}
        {d.kind === 'property' && action('property', 'Imóvel e índices', Building2)}
      </div>
      {open && (
        <div className="card card--pad form" role="region" aria-label={open.title}>
          <h3>{open.title}</h3>
          {open.body}
        </div>
      )}
    </section>
  );
}

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
  const [panel, setPanel] = useState<Panel | null>(null);

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
      <PageHeader
        title={d.name}
        back="/dividas"
        action={
          <button
            type="button"
            className="btn btn--ghost"
            aria-pressed={panel === 'edit'}
            onClick={() => setPanel(panel === 'edit' ? null : 'edit')}
          >
            <Pencil size={18} aria-hidden="true" />
            Editar
          </button>
        }
      />
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

      {d.status === 'active' ? (
        <DebtActionPanel d={d} panel={panel} setPanel={setPanel} />
      ) : (
        panel === 'edit' && (
          <section className="card card--pad form" aria-label="Editar dados">
            <h3>Editar dados</h3>
            <EditDebtForm d={d} onDone={() => setPanel(null)} />
          </section>
        )
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
              <dt>{d.completionConfirmed ? 'Entrega das chaves' : 'Entrega prevista'}</dt>
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
                  <button
                    type="button"
                    className="btn btn--ghost"
                    onClick={() => {
                      setPanel(null);
                      setPaying(i.id);
                    }}
                  >
                    {owedToMe ? 'Receber' : 'Pagar'}
                  </button>
                )}
              </span>
              {paying === i.id && (
                <div className="schedule-pay">
                  <PayInstallmentForm
                    debtId={d.id}
                    inst={i}
                    owedToMe={owedToMe}
                    onDone={() => setPaying(null)}
                  />
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

      {d.notes && (
        <section className="card card--pad" aria-label="Observações">
          <p className="pre-line">{d.notes}</p>
        </section>
      )}

      {d.status === 'active' && (
        <section className="form" aria-label="Cancelar">
          <button
            type="button"
            className="btn btn--ghost btn--danger"
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
