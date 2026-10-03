import { parseISODate } from '@finapp/core';
import { AlertTriangle, CalendarCheck, Landmark, Plus } from 'lucide-react';
import { Link } from 'react-router';
import { useMe } from '../auth/session';
import { TopBar } from '../layout/AppLayout';
import { dayLabel } from '../lib/dates';
import { money, monthShort } from '../lib/format';
import { useHiddenValues } from '../lib/hidden-values';
import { useAccounts, useConsolidated, useDashboard } from '../lib/queries';
import { errorText } from './transactions/EntryForm';

export function HomePage() {
  const { data: me } = useMe();
  const dash = useDashboard();
  const accounts = useAccounts();
  const consolidated = useConsolidated((me?.spaces.length ?? 0) > 1);
  const { hidden } = useHiddenValues();
  const firstName = me?.user.name.split(' ')[0] ?? '';

  if (dash.isPending) {
    return (
      <>
        <TopBar />
        <div className="skeleton" style={{ height: 168 }} />
        <div className="skeleton" style={{ height: 220 }} />
      </>
    );
  }
  if (dash.isError) {
    return (
      <>
        <TopBar />
        <p className="alert alert--error" role="alert">
          {errorText(dash.error)}{' '}
          <button type="button" className="btn btn--ghost" onClick={() => void dash.refetch()}>
            Tentar de novo
          </button>
        </p>
      </>
    );
  }
  const d = dash.data;

  if (!d.hasAccounts) {
    return (
      <>
        <TopBar />
        <h1>Olá, {firstName}</h1>
        <section className="card empty">
          <Landmark size={40} strokeWidth={1.5} aria-hidden="true" />
          <h2>Comece pelas suas contas</h2>
          <p className="muted">
            Cadastre onde seu dinheiro está (conta corrente, carteira, VR...) com o saldo de hoje.
            Depois é só lançar pelo +.
          </p>
          <Link to="/contas/nova" className="btn btn--primary">
            <Plus size={18} aria-hidden="true" />
            Nova conta
          </Link>
        </section>
      </>
    );
  }

  const { month } = parseISODate(d.forecastDate);
  const accountName = new Map((accounts.data ?? []).map((a) => [a.id, a.name]));
  const toPay = d.expense.planned;

  return (
    <>
      <TopBar />

      <section className="hero" aria-label="Saldo">
        <span className="hero__label">Saldo nas contas</span>
        <strong className="hero__value num">{money(d.balance, hidden)}</strong>
        <div className="hero__split">
          <div>
            <span>Previsto fim de {monthShort(month)}</span>
            <strong className="num">{money(d.forecastBalance, hidden)}</strong>
          </div>
          <div>
            <span>A pagar no mês</span>
            <strong className="num">{money(toPay, hidden)}</strong>
          </div>
        </div>
      </section>

      {consolidated.data && (
        <section className="card card--pad stack" aria-labelledby="all-spaces">
          <h2 id="all-spaces">Todos os espaços</h2>
          <dl className="invoice-head__rows">
            {consolidated.data.spaces.map((s) => (
              <div key={s.id}>
                <dt>
                  {s.name}
                  {s.type === 'shared' ? ' (compartilhado)' : ''}
                </dt>
                <dd className="num">{money(s.balance, hidden)}</dd>
              </div>
            ))}
            <div className="month-detail__total">
              <dt>Saldo total</dt>
              <dd className="num">{money(consolidated.data.totals.balance, hidden)}</dd>
            </div>
            <div>
              <dt>Previsto fim de {monthShort(month)}</dt>
              <dd className="num">{money(consolidated.data.totals.forecastBalance, hidden)}</dd>
            </div>
          </dl>
        </section>
      )}

      {d.overdueCount > 0 && (
        <Link to="/lancamentos" className="alert alert--link">
          <AlertTriangle size={18} aria-hidden="true" />
          {d.overdueCount === 1
            ? '1 lançamento previsto já venceu. Confirme ou ajuste a data.'
            : `${d.overdueCount} lançamentos previstos já venceram. Confirme ou ajuste as datas.`}
        </Link>
      )}

      <section className="stack" aria-labelledby="upcoming-title">
        <div className="section-head">
          <h2 id="upcoming-title">Próximos vencimentos</h2>
          <Link to="/lancamentos">Ver todos</Link>
        </div>
        {d.upcoming.length === 0 ? (
          <div className="card empty empty--compact">
            <CalendarCheck size={28} strokeWidth={1.5} aria-hidden="true" />
            <p className="muted">Nada previsto para os próximos 7 dias.</p>
          </div>
        ) : (
          <ul className="list card">
            {d.upcoming.map((t) => {
              const { day, month: m } = parseISODate(t.date);
              const late = t.date < d.today;
              const income = t.type === 'income' || t.type === 'transfer_in';
              return (
                <li key={t.id}>
                  <Link to={`/lancamentos/${t.id}`} className="row-link">
                    <span className={late ? 'date-tile date-tile--late' : 'date-tile'}>
                      <strong className="num">{String(day).padStart(2, '0')}</strong>
                      <span>{monthShort(m)}</span>
                    </span>
                    <span className="row-link__main">
                      <span className="row-link__title">{t.description}</span>
                      <span className="row-link__meta">
                        {late ? 'Venceu, ' : `${dayLabel(t.date, d.today)}, `}
                        {accountName.get(t.accountId ?? '') ?? 'conta'}
                      </span>
                    </span>
                    <strong className={`num ${income ? 'income' : 'expense'}`}>
                      {money(income ? t.amount : -t.amount, hidden, true)}
                    </strong>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="month-summary" aria-label={`Receitas e despesas de ${monthShort(month)}`}>
        <div className="card card--pad">
          <span className="muted">Entradas {monthShort(month)}</span>
          <strong className="num income">{money(d.income.settled, hidden, true)}</strong>
          {d.income.planned > 0 && (
            <span className="muted num">+ {money(d.income.planned, hidden)} previsto</span>
          )}
        </div>
        <div className="card card--pad">
          <span className="muted">Saídas {monthShort(month)}</span>
          <strong className="num expense">{money(-d.expense.settled, hidden, true)}</strong>
          {d.expense.planned > 0 && (
            <span className="muted num">+ {money(d.expense.planned, hidden)} previsto</span>
          )}
        </div>
      </section>
    </>
  );
}
