import { parseYearMonth } from '@finapp/core';
import type { ProjectionMonthDto } from '@finapp/shared';
import { AlertTriangle } from 'lucide-react';
import { useState } from 'react';
import { BarChart } from '../../components/BarChart';
import { PageHeader } from '../../components/PageHeader';
import { monthLabel } from '../../lib/dates';
import { compactBRL, money, monthShort } from '../../lib/format';
import { useHiddenValues } from '../../lib/hidden-values';
import { useProjection } from '../../lib/queries';
import { errorText } from '../transactions/EntryForm';

const RANGES = [6, 12, 24] as const;

const outflow = (m: ProjectionMonthDto) => m.committed + m.otherExpenses;
const shortMonth = (ym: string) => monthShort(parseYearMonth(ym).month);

function MonthDetail({ m }: { m: ProjectionMonthDto }) {
  const { hidden } = useHiddenValues();
  const rows: [string, number, string?][] = [
    ['Saldo no início', m.openingBalance],
    ['Receitas', m.income, 'income'],
    ['Despesas fixas', -m.fixedExpenses],
    ['Faturas de cartão', -m.invoices],
    ['Parcelas', -m.debts],
    ['Outras despesas', -m.otherExpenses],
  ];
  return (
    <section
      className="card card--pad month-detail"
      aria-label={`Detalhe de ${monthLabel(m.month)}`}
    >
      <h3>{monthLabel(m.month)}</h3>
      <dl className="invoice-head__rows">
        {rows
          .filter(([, v], i) => i === 0 || v !== 0)
          .map(([label, v, tone]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd className={`num ${tone ?? ''}`}>
                {money(v, hidden, label !== 'Saldo no início')}
              </dd>
            </div>
          ))}
        <div className="month-detail__total">
          <dt>Saldo no fim</dt>
          <dd className={`num ${m.negative ? 'expense' : ''}`}>
            {money(m.closingBalance, hidden)}
          </dd>
        </div>
        <div>
          <dt>Livre no mês (receitas − comprometido)</dt>
          <dd className="num">{money(m.free, hidden, true)}</dd>
        </div>
      </dl>
    </section>
  );
}

/** Projeção dos próximos meses (RN 7). Gráficos pela skill dataviz. */
export function PlanningPage() {
  const [months, setMonths] = useState<(typeof RANGES)[number]>(12);
  const projection = useProjection(months);
  const { hidden } = useHiddenValues();
  const [selected, setSelected] = useState<string | null>(null);

  const data = projection.data?.months ?? [];
  const sel = data.find((m) => m.month === selected) ?? data[0];
  const lowest = data.reduce<ProjectionMonthDto | undefined>(
    (low, m) => (!low || m.closingBalance < low.closingBalance ? m : low),
    undefined,
  );
  const negatives = data.filter((m) => m.negative);
  const fmt = (v: number) => (hidden ? '' : compactBRL(v));

  return (
    <>
      <PageHeader title="Planejamento" back="/mais" />
      <div className="segmented" role="group" aria-label="Período">
        {RANGES.map((r) => (
          <button key={r} type="button" aria-pressed={months === r} onClick={() => setMonths(r)}>
            {r} meses
          </button>
        ))}
      </div>

      {projection.isPending && <div className="skeleton" style={{ height: 320 }} />}
      {projection.isError && (
        <p className="alert alert--error" role="alert">
          {errorText(projection.error)}
        </p>
      )}

      {lowest && (
        <section className="stat-row" aria-label="Resumo">
          <div className="card card--pad stat">
            <span className="muted">Menor saldo previsto</span>
            <strong className={`num ${lowest.negative ? 'expense' : ''}`}>
              {money(lowest.closingBalance, hidden)}
            </strong>
            <span className="muted">no fim de {monthLabel(lowest.month)}</span>
          </div>
          <div className="card card--pad stat">
            <span className="muted">Saldo no fim de {monthLabel(data.at(-1)?.month ?? '')}</span>
            <strong className="num">{money(data.at(-1)?.closingBalance ?? 0, hidden)}</strong>
            <span className="muted">
              hoje: {money(projection.data?.startingBalance ?? 0, hidden)}
            </span>
          </div>
        </section>
      )}

      {negatives.length > 0 && (
        <p className="alert alert--icon" role="status">
          <AlertTriangle size={18} aria-hidden="true" />
          <span>
            Saldo negativo previsto em{' '}
            {negatives.length === 1 ? '1 mês' : `${negatives.length} meses`}:{' '}
            {negatives.map((m) => monthLabel(m.month)).join(', ')}.
          </span>
        </p>
      )}

      {data.length > 0 && (
        <>
          <section className="card card--pad stack" aria-labelledby="chart-balance">
            <h2 id="chart-balance">Saldo no fim de cada mês</h2>
            <BarChart
              rows={data}
              rowKey={(m) => m.month}
              rowLabel={(m) => shortMonth(m.month)}
              series={[
                {
                  key: 'closing',
                  label: 'Saldo no fim do mês',
                  value: (m) => m.closingBalance,
                  color: (m) => (m.negative ? 'var(--expense)' : 'var(--series-1)'),
                },
              ]}
              formatValue={fmt}
              describe={(m) => (
                <>
                  <strong>{monthLabel(m.month)}</strong>
                  <span>
                    Saldo no fim: {money(m.closingBalance, hidden)}
                    {m.negative ? ' (negativo)' : ''}
                  </span>
                </>
              )}
              selected={sel?.month ?? null}
              onSelect={setSelected}
              summary={`Saldo previsto no fim de cada mês, de ${monthLabel(data[0]?.month ?? '')} a ${monthLabel(data.at(-1)?.month ?? '')}. Menor: ${money(lowest?.closingBalance ?? 0, hidden)} em ${monthLabel(lowest?.month ?? '')}.`}
            />
          </section>

          <section className="card card--pad stack" aria-labelledby="chart-flow">
            <h2 id="chart-flow">Entradas e saídas previstas</h2>
            <BarChart
              rows={data}
              rowKey={(m) => m.month}
              rowLabel={(m) => shortMonth(m.month)}
              series={[
                { key: 'in', label: 'Entradas', value: (m) => m.income, color: 'var(--series-1)' },
                { key: 'out', label: 'Saídas', value: outflow, color: 'var(--series-2)' },
              ]}
              formatValue={fmt}
              describe={(m) => (
                <>
                  <strong>{monthLabel(m.month)}</strong>
                  <span>Entradas: {money(m.income, hidden)}</span>
                  <span>Saídas: {money(outflow(m), hidden)}</span>
                </>
              )}
              selected={sel?.month ?? null}
              onSelect={setSelected}
              height={170}
              summary="Entradas e saídas previstas em cada mês."
            />
          </section>

          {sel && <MonthDetail m={sel} />}

          <details className="card card--pad table-view">
            <summary>Ver como tabela</summary>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Mês</th>
                    <th scope="col">Entradas</th>
                    <th scope="col">Saídas</th>
                    <th scope="col">Saldo no fim</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((m) => (
                    <tr key={m.month}>
                      <th scope="row">{monthLabel(m.month)}</th>
                      <td className="num">{money(m.income, hidden)}</td>
                      <td className="num">{money(outflow(m), hidden)}</td>
                      <td className={`num ${m.negative ? 'expense' : ''}`}>
                        {money(m.closingBalance, hidden)}
                      </td>
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
