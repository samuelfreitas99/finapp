import { ChevronRight, Landmark, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { PageHeader } from '../../components/PageHeader';
import { ACCOUNT_TYPE_META } from '../../lib/accounts';
import { money } from '../../lib/format';
import { useHiddenValues } from '../../lib/hidden-values';
import { useAccounts } from '../../lib/queries';

export function AccountsPage() {
  const [showArchived, setShowArchived] = useState(false);
  const accounts = useAccounts({ includeArchived: showArchived });
  const { hidden } = useHiddenValues();
  const items = accounts.data ?? [];
  const active = items.filter((a) => !a.archived);
  const total = active.filter((a) => a.includeInTotals).reduce((s, a) => s + a.balance, 0);
  const forecast = active
    .filter((a) => a.includeInTotals)
    .reduce((s, a) => s + a.forecastBalance, 0);

  return (
    <>
      <PageHeader
        title="Contas"
        action={
          <Link to="/contas/nova" className="btn btn--primary">
            <Plus size={18} aria-hidden="true" />
            Nova conta
          </Link>
        }
      />

      {accounts.isPending && <div className="skeleton" style={{ height: 240 }} />}

      {accounts.isError && (
        <div className="alert alert--error" role="alert">
          Não foi possível carregar as contas.{' '}
          <button type="button" className="btn btn--ghost" onClick={() => void accounts.refetch()}>
            Tentar de novo
          </button>
        </div>
      )}

      {accounts.isSuccess && active.length === 0 && !showArchived && (
        <section className="card empty">
          <Landmark size={40} strokeWidth={1.5} aria-hidden="true" />
          <h2>Cadastre sua primeira conta</h2>
          <p className="muted">
            Conta corrente, poupança, dinheiro, VR/VA... Informe o saldo de hoje e o FinApp calcula
            o resto a partir dos lançamentos.
          </p>
          <Link to="/contas/nova" className="btn btn--primary">
            <Plus size={18} aria-hidden="true" />
            Nova conta
          </Link>
        </section>
      )}

      {active.length > 0 && (
        <section className="totals card card--pad" aria-label="Total das contas">
          <div>
            <span className="muted">Saldo nas contas</span>
            <strong className="num totals__value">{money(total, hidden)}</strong>
          </div>
          <div>
            <span className="muted">Previsto no fim do mês</span>
            <strong className="num">{money(forecast, hidden)}</strong>
          </div>
        </section>
      )}

      {items.length > 0 && (
        <ul className="list card">
          {items.map((a) => {
            const meta = ACCOUNT_TYPE_META[a.type];
            const Icon = meta.icon;
            return (
              <li key={a.id}>
                <Link to={`/contas/${a.id}`} className="row-link">
                  <span
                    className="avatar"
                    style={{ background: a.color ?? 'var(--primary)' }}
                    aria-hidden="true"
                  >
                    <Icon size={20} />
                  </span>
                  <span className="row-link__main">
                    <span className="row-link__title">{a.name}</span>
                    <span className="row-link__meta">
                      {meta.label}
                      {a.archived ? ', arquivada' : ''}
                      {!a.includeInTotals && !a.archived ? ', fora dos totais' : ''}
                    </span>
                  </span>
                  <span className="row-link__value">
                    <strong className={`num ${a.balance < 0 ? 'expense' : ''}`}>
                      {money(a.balance, hidden)}
                    </strong>
                    {a.forecastBalance !== a.balance && (
                      <span className="row-link__meta num">
                        prev. {money(a.forecastBalance, hidden)}
                      </span>
                    )}
                  </span>
                  <ChevronRight size={18} aria-hidden="true" className="muted" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {accounts.isSuccess && (
        <button
          type="button"
          className="btn btn--ghost"
          aria-pressed={showArchived}
          onClick={() => setShowArchived((v) => !v)}
        >
          {showArchived ? 'Esconder arquivadas' : 'Mostrar arquivadas'}
        </button>
      )}
    </>
  );
}
