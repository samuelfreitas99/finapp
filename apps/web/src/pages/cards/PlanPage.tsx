import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { PageHeader } from '../../components/PageHeader';
import { useToast } from '../../components/Toast';
import { monthLabel } from '../../lib/dates';
import { formatDate, money } from '../../lib/format';
import { useHiddenValues } from '../../lib/hidden-values';
import { useInstallmentPlan, usePlanAction } from '../../lib/queries';
import { errorText } from '../transactions/EntryForm';

const STATUS: Record<string, string> = {
  active: 'Ativo',
  finished: 'Quitado',
  cancelled: 'Cancelado',
};

export function PlanPage() {
  const { id = '' } = useParams();
  const plan = useInstallmentPlan(id);
  const action = usePlanAction(id);
  const toast = useToast();
  const navigate = useNavigate();
  const { hidden } = useHiddenValues();
  const [count, setCount] = useState(1);
  const [rate, setRate] = useState('');
  const [refund, setRefund] = useState(false);

  if (plan.isPending) return <div className="skeleton" style={{ height: 420 }} />;
  if (plan.isError || !plan.data) {
    return (
      <>
        <PageHeader title="Parcelamento" back="/cartoes" />
        <p className="alert alert--error" role="alert">
          {errorText(plan.error)}
        </p>
      </>
    );
  }
  const p = plan.data;
  const back = p.cardId ? `/cartoes?cartao=${p.cardId}` : '/lancamentos';
  const done = p.summary.paidCount + (p.startInstallment - 1);
  const remainingCount = p.summary.remainingCount;
  const rateNumber = Number(rate.replace(',', '.'));
  const validRate = rate === '' || (rateNumber >= 0 && rateNumber < 100);

  return (
    <>
      <PageHeader title={p.description} back={back} />
      <section className="card card--pad form" aria-label="Resumo">
        <div className="invoice-head__top">
          <span className={`pill pill--${p.status}`}>{STATUS[p.status]}</span>
          <span className="muted">
            {p.installments}x, total {money(p.totalAmount, hidden)}
          </span>
        </div>
        <span
          className="progress progress--large"
          role="progressbar"
          aria-label={`${done} de ${p.installments} parcelas pagas`}
          aria-valuemin={0}
          aria-valuemax={p.installments}
          aria-valuenow={done}
        >
          <span style={{ width: `${(done / p.installments) * 100}%` }} />
        </span>
        <dl className="invoice-head__rows">
          <div>
            <dt>Pagas</dt>
            <dd className="num">
              {done} de {p.installments}
            </dd>
          </div>
          <div>
            <dt>Já pago</dt>
            <dd className="num">{money(p.summary.paidAmount, hidden)}</dd>
          </div>
          <div>
            <dt>Falta</dt>
            <dd className="num">{money(p.summary.remainingAmount, hidden)}</dd>
          </div>
        </dl>
      </section>

      <section className="stack" aria-labelledby="installments-title">
        <h2 id="installments-title">Parcelas</h2>
        <ul className="list card">
          {p.entries.map((e) => (
            <li key={e.id} className="row-link">
              <span className="row-link__main">
                <span className="row-link__title">
                  {e.installmentNumber}/{p.installments}
                  {e.anticipated ? ', antecipada' : ''}
                </span>
                <span className="row-link__meta">{formatDate(e.date)}</span>
              </span>
              <strong className="num">{money(e.amount, hidden)}</strong>
            </li>
          ))}
        </ul>
      </section>

      {action.isError && (
        <p className="alert alert--error" role="alert">
          {errorText(action.error)}
        </p>
      )}

      {p.status === 'active' && p.cardId && remainingCount > 1 && (
        <form
          className="card card--pad form"
          onSubmit={(e) => {
            e.preventDefault();
            action.mutate(
              {
                action: 'anticipate',
                body: {
                  count,
                  ...(rate !== '' ? { discount: { monthlyRate: rateNumber / 100 } } : {}),
                },
              },
              {
                onSuccess: (r) =>
                  toast({
                    text: r.discount
                      ? `${count} parcela(s) antecipada(s), desconto de ${money(r.discount)}.`
                      : `${count} parcela(s) antecipada(s) para a fatura aberta.`,
                  }),
              },
            );
          }}
        >
          <h3>Antecipar parcelas</h3>
          <p className="muted">
            As últimas parcelas vão para a fatura aberta. Com a taxa do banco, o FinApp calcula o
            desconto (arredondado para baixo).
          </p>
          <div className="field">
            <label htmlFor="anticipate-count">Quantas</label>
            <select
              id="anticipate-count"
              className="input"
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
            >
              {Array.from({ length: remainingCount - 1 }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="anticipate-rate">Taxa mensal de desconto (%, opcional)</label>
            <input
              id="anticipate-rate"
              className="input num"
              inputMode="decimal"
              placeholder="Ex.: 1,99"
              aria-invalid={!validRate}
              value={rate}
              onChange={(e) => setRate(e.target.value)}
            />
          </div>
          <button type="submit" className="btn" disabled={action.isPending || !validRate}>
            Antecipar {count} parcela(s)
          </button>
        </form>
      )}

      {p.status === 'active' && (
        <section className="card card--pad form" aria-label="Cancelar parcelamento">
          {p.cardId && (
            <label className="toggle">
              <input
                type="checkbox"
                checked={refund}
                onChange={(e) => setRefund(e.target.checked)}
              />
              <span>
                <strong>O banco vai devolver as parcelas já cobradas</strong>
                <span className="muted">Vira um estorno na fatura aberta.</span>
              </span>
            </label>
          )}
          <button
            type="button"
            className="btn btn--danger"
            disabled={action.isPending}
            onClick={() => {
              if (!window.confirm(`Cancelar o parcelamento "${p.description}"?`)) return;
              action.mutate(
                { action: 'cancel', body: { refundBilled: refund } },
                {
                  onSuccess: () => {
                    toast({ text: 'Parcelamento cancelado.' });
                    navigate(back);
                  },
                },
              );
            }}
          >
            Cancelar parcelamento
          </button>
        </section>
      )}
      {p.next?.invoiceMonth && (
        <p className="muted">Próxima parcela na fatura de {monthLabel(p.next.invoiceMonth)}.</p>
      )}
    </>
  );
}
