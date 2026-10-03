import { addYearMonths, parseYearMonth } from '@finapp/core';
import type { ByCategoryReport, Debt } from '@finapp/shared';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { BarChart } from '../../components/BarChart';
import { PageHeader } from '../../components/PageHeader';
import { currentMonth, monthLabel } from '../../lib/dates';
import { compactBRL, formatDate, money, monthShort } from '../../lib/format';
import { useHiddenValues } from '../../lib/hidden-values';
import {
  useDebts,
  useReportByCategory,
  useReportMonthly,
  useReportNetWorth,
} from '../../lib/queries';
import { errorText } from '../transactions/EntryForm';

type Tab = 'category' | 'monthly' | 'net-worth' | 'debts';
const TABS: { id: Tab; label: string }[] = [
  { id: 'category', label: 'Categorias' },
  { id: 'monthly', label: 'Mensal' },
  { id: 'net-worth', label: 'Patrimônio' },
  { id: 'debts', label: 'Dívidas' },
];

const pct = (v: number) => `${Math.round(v * 100)}%`;
const shortMonth = (ym: string) => monthShort(parseYearMonth(ym).month);

function Loading({ query }: { query: { isPending: boolean; isError: boolean; error: unknown } }) {
  if (query.isPending) return <div className="skeleton" style={{ height: 200 }} />;
  if (query.isError)
    return (
      <p className="alert alert--error" role="alert">
        {errorText(query.error)}
      </p>
    );
  return null;
}

function CategoryTab() {
  const { hidden } = useHiddenValues();
  const [month, setMonth] = useState(currentMonth());
  const [kind, setKind] = useState<ByCategoryReport['kind']>('expense');
  const report = useReportByCategory(month, month, kind);
  const prev = useReportByCategory(addYearMonths(month, -1), addYearMonths(month, -1), kind);
  const data = report.data;
  const prevTotal = prev.data?.total;
  const diff = data && prevTotal ? (data.total - prevTotal) / prevTotal : null;
  return (
    <>
      <div className="segmented" role="group" aria-label="Tipo">
        <button type="button" aria-pressed={kind === 'expense'} onClick={() => setKind('expense')}>
          Despesas
        </button>
        <button type="button" aria-pressed={kind === 'income'} onClick={() => setKind('income')}>
          Receitas
        </button>
      </div>
      <div className="month-nav" role="group" aria-label="Mês">
        <button
          type="button"
          className="icon-btn"
          aria-label="Mês anterior"
          onClick={() => setMonth((m) => addYearMonths(m, -1))}
        >
          <ChevronLeft size={20} aria-hidden="true" />
        </button>
        <span className="month-nav__label" aria-live="polite">
          {monthLabel(month)}
        </span>
        <button
          type="button"
          className="icon-btn"
          aria-label="Próximo mês"
          onClick={() => setMonth((m) => addYearMonths(m, 1))}
        >
          <ChevronRight size={20} aria-hidden="true" />
        </button>
      </div>
      <Loading query={report} />
      {data && (
        <section className="card card--pad stack" aria-label="Por categoria">
          <div>
            <span className="muted">{kind === 'expense' ? 'Gasto no mês' : 'Recebido no mês'}</span>
            <strong className="num report-total">{money(data.total, hidden)}</strong>
            {diff !== null && (
              <span className="muted">
                {diff >= 0 ? '+' : '−'}
                {pct(Math.abs(diff))} em relação a {monthLabel(addYearMonths(month, -1))}
              </span>
            )}
          </div>
          {data.items.length === 0 && (
            <p className="muted">Nada {kind === 'expense' ? 'gasto' : 'recebido'} neste mês.</p>
          )}
          <ul className="report-bars">
            {data.items.map((i) => (
              <li key={i.id}>
                <div className="report-bars__head">
                  <span>{i.name}</span>
                  <span className="num">
                    {money(i.amount, hidden)} · {pct(i.share)}
                  </span>
                </div>
                <span
                  className="progress"
                  role="img"
                  aria-label={`${i.name}: ${pct(i.share)} do total`}
                >
                  <span
                    className="budget-bar"
                    style={{
                      width: `${Math.max(2, Math.round(i.share * 100))}%`,
                      background: 'var(--series-1)',
                    }}
                  />
                </span>
              </li>
            ))}
          </ul>
          <p className="muted">
            Despesas por competência: compras no cartão entram no mês da fatura. Só o que já foi
            efetivado.
          </p>
        </section>
      )}
    </>
  );
}

function MonthlyTab() {
  const { hidden } = useHiddenValues();
  const [months, setMonths] = useState<6 | 12 | 24>(12);
  const report = useReportMonthly(months);
  const data = report.data;
  return (
    <>
      <div className="segmented" role="group" aria-label="Período">
        {([6, 12, 24] as const).map((m) => (
          <button key={m} type="button" aria-pressed={months === m} onClick={() => setMonths(m)}>
            {m} meses
          </button>
        ))}
      </div>
      <Loading query={report} />
      {data && (
        <>
          <section className="card card--pad stack" aria-labelledby="rep-monthly">
            <h2 id="rep-monthly">Receitas e despesas</h2>
            <BarChart
              rows={data.items}
              rowKey={(m) => m.month}
              rowLabel={(m) => shortMonth(m.month)}
              series={[
                { key: 'in', label: 'Receitas', value: (m) => m.income, color: 'var(--series-1)' },
                {
                  key: 'out',
                  label: 'Despesas',
                  value: (m) => m.expense,
                  color: 'var(--series-2)',
                },
              ]}
              formatValue={(v) => compactBRL(v)}
              describe={(m) => (
                <>
                  <strong>{monthLabel(m.month)}</strong>
                  <span>Receitas: {money(m.income, hidden)}</span>
                  <span>Despesas: {money(m.expense, hidden)}</span>
                  <span>
                    Sobrou: {money(m.balance, hidden)}
                    {m.savingsRate !== null ? ` (${pct(m.savingsRate)} da renda)` : ''}
                  </span>
                </>
              )}
              height={190}
              summary={`Receitas e despesas efetivadas nos últimos ${months} meses. Total de receitas ${money(data.totals.income, hidden)} e de despesas ${money(data.totals.expense, hidden)}.`}
            />
            <dl className="invoice-head__rows">
              <div>
                <dt>Receitas no período</dt>
                <dd className="num income">{money(data.totals.income, hidden)}</dd>
              </div>
              <div>
                <dt>Despesas no período</dt>
                <dd className="num">{money(data.totals.expense, hidden)}</dd>
              </div>
              <div>
                <dt>Sobrou</dt>
                <dd className={`num ${data.totals.balance < 0 ? 'expense' : ''}`}>
                  {money(data.totals.balance, hidden)}
                  {data.totals.savingsRate !== null ? ` (${pct(data.totals.savingsRate)})` : ''}
                </dd>
              </div>
            </dl>
          </section>
          <details className="card card--pad table-view">
            <summary>Ver como tabela</summary>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Mês</th>
                    <th scope="col">Receitas</th>
                    <th scope="col">Despesas</th>
                    <th scope="col">Sobrou</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((m) => (
                    <tr key={m.month}>
                      <th scope="row">{monthLabel(m.month)}</th>
                      <td className="num">{money(m.income, hidden)}</td>
                      <td className="num">{money(m.expense, hidden)}</td>
                      <td className="num">{money(m.balance, hidden)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </>
  );
}

function NetWorthTab() {
  const { hidden } = useHiddenValues();
  const report = useReportNetWorth();
  const d = report.data;
  return (
    <>
      <Loading query={report} />
      {d && (
        <>
          <section className="card card--pad stack" aria-label="Patrimônio líquido">
            <span className="muted">Patrimônio líquido hoje</span>
            <strong className={`num report-total ${d.net < 0 ? 'expense' : ''}`}>
              {money(d.net, hidden)}
            </strong>
            <span className="muted">
              {money(d.assets, hidden)} que você tem − {money(d.liabilities, hidden)} que você deve
            </span>
          </section>
          <section className="card card--pad stack" aria-labelledby="nw-assets">
            <h2 id="nw-assets">O que você tem</h2>
            <dl className="invoice-head__rows">
              {d.assetLines.length === 0 && <p className="muted">Nada cadastrado.</p>}
              {d.assetLines.map((l) => (
                <div key={l.label}>
                  <dt>{l.label}</dt>
                  <dd className="num income">{money(l.amount, hidden)}</dd>
                </div>
              ))}
            </dl>
          </section>
          <section className="card card--pad stack" aria-labelledby="nw-liab">
            <h2 id="nw-liab">O que você deve</h2>
            <dl className="invoice-head__rows">
              {d.liabilityLines.length === 0 && <p className="muted">Nenhuma dívida.</p>}
              {d.liabilityLines.map((l) => (
                <div key={l.label}>
                  <dt>{l.label}</dt>
                  <dd className="num">{money(l.amount, hidden)}</dd>
                </div>
              ))}
            </dl>
            <p className="muted">
              Dívidas pelo principal ainda não amortizado (sem juros futuros). Imóvel só conta
              depois de entregue.
            </p>
          </section>
        </>
      )}
    </>
  );
}

function DebtsTab() {
  const { hidden } = useHiddenValues();
  const debts = useDebts();
  const active = (debts.data ?? []).filter((d) => d.status === 'active');
  const owe = active.filter((d) => d.direction === 'i_owe');
  const owed = active.filter((d) => d.direction === 'owed_to_me');
  const sum = (list: Debt[], pick: (d: Debt) => number) => list.reduce((s, d) => s + pick(d), 0);
  const row = (d: Debt) => (
    <li key={d.id} className="report-debt">
      <div className="report-bars__head">
        <strong>{d.name}</strong>
        <span className="num">{money(d.summary.outstandingPrincipal, hidden)}</span>
      </div>
      <span
        className="progress"
        role="progressbar"
        aria-label={`${d.name}: ${pct(d.summary.progressByAmount)} quitado`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(d.summary.progressByAmount * 100)}
      >
        <span
          className="budget-bar budget-bar--ok"
          style={{ width: `${Math.round(d.summary.progressByAmount * 100)}%` }}
        />
      </span>
      <span className="muted">
        {pct(d.summary.progressByAmount)} pago · faltam {d.summary.remainingCount} de{' '}
        {d.summary.totalCount} parcelas · juros a pagar {money(d.summary.interestToPay, hidden)}
        {d.summary.expectedPayoffDate
          ? ` · quita em ${formatDate(d.summary.expectedPayoffDate)}`
          : ''}
        {d.summary.lateCount > 0 ? ` · ${d.summary.lateCount} em atraso` : ''}
      </span>
    </li>
  );
  return (
    <>
      <Loading query={debts} />
      {debts.isSuccess && active.length === 0 && (
        <section className="card empty">
          <h2>Nenhuma dívida ativa</h2>
        </section>
      )}
      {owe.length > 0 && (
        <section className="card card--pad stack" aria-labelledby="rd-owe">
          <h2 id="rd-owe">Você deve</h2>
          <dl className="invoice-head__rows">
            <div>
              <dt>Saldo devedor (principal)</dt>
              <dd className="num">
                {money(
                  sum(owe, (d) => d.summary.outstandingPrincipal),
                  hidden,
                )}
              </dd>
            </div>
            <div>
              <dt>Juros ainda a pagar</dt>
              <dd className="num">
                {money(
                  sum(owe, (d) => d.summary.interestToPay),
                  hidden,
                )}
              </dd>
            </div>
            <div>
              <dt>Já pago</dt>
              <dd className="num">
                {money(
                  sum(owe, (d) => d.summary.paidAmount),
                  hidden,
                )}
              </dd>
            </div>
          </dl>
          <ul className="stack">{owe.map(row)}</ul>
        </section>
      )}
      {owed.length > 0 && (
        <section className="card card--pad stack" aria-labelledby="rd-owed">
          <h2 id="rd-owed">Te devem</h2>
          <ul className="stack">{owed.map(row)}</ul>
        </section>
      )}
    </>
  );
}

/** Relatórios: por categoria, mensal, patrimônio e dívidas. */
export function ReportsPage() {
  const [tab, setTab] = useState<Tab>('category');
  return (
    <>
      <PageHeader title="Relatórios" back="/mais" />
      <div className="segmented" role="tablist" aria-label="Relatório">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            aria-pressed={tab === t.id}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'category' && <CategoryTab />}
      {tab === 'monthly' && <MonthlyTab />}
      {tab === 'net-worth' && <NetWorthTab />}
      {tab === 'debts' && <DebtsTab />}
    </>
  );
}
