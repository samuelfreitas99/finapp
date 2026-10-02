import type { Debt } from '@finapp/shared';
import { ChevronRight, HandCoins, Plus } from 'lucide-react';
import { Link } from 'react-router';
import { PageHeader } from '../../components/PageHeader';
import { DEBT_KIND_META } from '../../lib/debts';
import { formatDate, money } from '../../lib/format';
import { useHiddenValues } from '../../lib/hidden-values';
import { useDebts } from '../../lib/queries';
import { errorText } from '../transactions/EntryForm';

function DebtRowItem({ d }: { d: Debt }) {
  const { hidden } = useHiddenValues();
  const meta = DEBT_KIND_META[d.kind];
  const Icon = meta.icon;
  const pct = Math.round(d.summary.progressByAmount * 100);
  return (
    <li>
      <Link to={`/dividas/${d.id}`} className="row-link plan-row">
        <span className="avatar" style={{ background: 'var(--hero)' }} aria-hidden="true">
          <Icon size={18} />
        </span>
        <span className="row-link__main">
          <span className="row-link__title">{d.name}</span>
          <span
            className="progress"
            role="progressbar"
            aria-label={`${pct}% quitado`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
          >
            <span style={{ width: `${pct}%` }} />
          </span>
          <span className="row-link__meta">
            {pct}% quitado, {d.summary.paidCount} de {d.summary.totalCount} parcelas
            {d.summary.lateCount > 0 ? `, ${d.summary.lateCount} atrasada(s)` : ''}
            {d.next
              ? `. Próxima: ${money(d.next.amount - d.next.paidAmount, hidden)} em ${formatDate(d.next.dueDate)}`
              : ''}
          </span>
        </span>
        <span className="row-link__value">
          <strong className="num">{money(d.summary.remainingAmount, hidden)}</strong>
          <span className="row-link__meta">restante</span>
        </span>
        <ChevronRight size={18} aria-hidden="true" className="muted" />
      </Link>
    </li>
  );
}

/** Dívidas e empréstimos (devo e me devem). @see RN 6.4 */
export function DebtsPage() {
  const list = useDebts();
  const { hidden } = useHiddenValues();
  const items = (list.data ?? []).filter((d) => d.status !== 'cancelled');
  const owe = items.filter((d) => d.direction === 'i_owe' && d.status === 'active');
  const owed = items.filter((d) => d.direction === 'owed_to_me' && d.status === 'active');
  const done = items.filter((d) => d.status === 'paid_off');
  const total = (ds: Debt[]) => ds.reduce((s, d) => s + d.summary.remainingAmount, 0);

  return (
    <>
      <PageHeader
        title="Dívidas"
        action={
          <Link to="/dividas/nova" className="btn btn--primary">
            <Plus size={18} aria-hidden="true" />
            Nova
          </Link>
        }
      />
      {list.isPending && <div className="skeleton" style={{ height: 240 }} />}
      {list.isError && (
        <p className="alert alert--error" role="alert">
          {errorText(list.error)}
        </p>
      )}
      {list.isSuccess && items.length === 0 && (
        <section className="card empty">
          <HandCoins size={40} strokeWidth={1.5} aria-hidden="true" />
          <h2>Nenhuma dívida cadastrada</h2>
          <p className="muted">
            Empréstimos, financiamentos, imóvel na planta, dinheiro que você pegou ou emprestou. O
            FinApp monta o cronograma e mostra quanto falta.
          </p>
          <Link to="/dividas/nova" className="btn btn--primary">
            <Plus size={18} aria-hidden="true" />
            Cadastrar dívida
          </Link>
        </section>
      )}
      {(owe.length > 0 || owed.length > 0) && (
        <section className="stat-row" aria-label="Totais">
          {owe.length > 0 && (
            <div className="card card--pad stat">
              <span className="muted">Você deve</span>
              <strong className="num">{money(total(owe), hidden)}</strong>
              <span className="muted">{owe.length} dívida(s)</span>
            </div>
          )}
          {owed.length > 0 && (
            <div className="card card--pad stat">
              <span className="muted">Te devem</span>
              <strong className="num income">{money(total(owed), hidden)}</strong>
              <span className="muted">{owed.length} empréstimo(s)</span>
            </div>
          )}
        </section>
      )}
      {owe.length > 0 && (
        <section className="stack" aria-label="Você deve">
          <h2>Você deve</h2>
          <ul className="list card">
            {owe.map((d) => (
              <DebtRowItem key={d.id} d={d} />
            ))}
          </ul>
        </section>
      )}
      {owed.length > 0 && (
        <section className="stack" aria-label="Te devem">
          <h2>Te devem</h2>
          <ul className="list card">
            {owed.map((d) => (
              <DebtRowItem key={d.id} d={d} />
            ))}
          </ul>
        </section>
      )}
      {done.length > 0 && (
        <section className="stack" aria-label="Quitadas">
          <h2>Quitadas</h2>
          <ul className="list card">
            {done.map((d) => (
              <DebtRowItem key={d.id} d={d} />
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
