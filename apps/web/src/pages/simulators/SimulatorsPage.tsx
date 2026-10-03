import {
  addYearMonths,
  balanceImpact,
  cashVsInstallments,
  installmentOffer,
  yearMonthOf,
} from '@finapp/core';
import { useMemo, useState } from 'react';
import { MoneyInput } from '../../components/MoneyInput';
import { PageHeader } from '../../components/PageHeader';
import { currentMonth, monthLabel, today } from '../../lib/dates';
import { formatDate, money } from '../../lib/format';
import { useHiddenValues } from '../../lib/hidden-values';
import {
  useCards,
  useDebts,
  useInstallmentPreview,
  useProjection,
  useSimulateDebt,
} from '../../lib/queries';
import { errorText } from '../transactions/EntryForm';
import { IntegerInput } from '../../components/NumberInputs';

type Tab = 'purchase' | 'debt';

const rateOf = (text: string): number | null => {
  const n = Number(text.trim().replace(',', '.'));
  return text.trim() !== '' && Number.isFinite(n) && n >= 0 && n < 100 ? n / 100 : null;
};
const pctText = (rate: number) => `${(rate * 100).toFixed(2).replace('.', ',')}% ao mês`;

function PurchaseSimulator() {
  const { hidden } = useHiddenValues();
  const cards = useCards();
  const [price, setPrice] = useState(0);
  const [n, setN] = useState(12);
  const [how, setHow] = useState<'free' | 'rate' | 'amount'>('free');
  const [rate, setRate] = useState('');
  const [amount, setAmount] = useState(0);
  const [cardId, setCardId] = useState('');
  const [cashPrice, setCashPrice] = useState(0);
  const [opportunity, setOpportunity] = useState('0,8');

  const offer = useMemo(() => {
    if (price <= 0 || n < 1) return null;
    try {
      if (how === 'free') return installmentOffer({ price, installments: n, monthlyRate: 0 });
      if (how === 'rate') {
        const r = rateOf(rate);
        return r === null ? null : installmentOffer({ price, installments: n, monthlyRate: r });
      }
      return amount > 0
        ? installmentOffer({ price, installments: n, installmentAmount: amount })
        : null;
    } catch {
      return null;
    }
  }, [price, n, how, rate, amount]);

  // Datas reais das parcelas: no cartão, pela fatura; sem cartão, uma por mês a partir do próximo.
  const preview = useInstallmentPreview(
    offer && cardId
      ? {
          description: 'Simulação',
          cardId,
          installmentAmount: offer.installmentAmount,
          installments: n,
          firstDate: today(),
          adjust: 'none',
          startInstallment: 1,
          interestAmount: 0,
        }
      : null,
  );
  const months = Math.min(36, Math.max(12, n + 3));
  const projection = useProjection(months);

  const outflows = useMemo(() => {
    if (!offer) return [];
    if (cardId) {
      return (preview.data?.items ?? []).map((i) => ({
        month: yearMonthOf(i.date),
        amount: i.amount,
      }));
    }
    return Array.from({ length: n }, (_, k) => ({
      month: addYearMonths(currentMonth(), k + 1),
      amount: offer.installmentAmount,
    }));
  }, [offer, cardId, preview.data, n]);

  const impact = useMemo(
    () =>
      projection.data
        ? balanceImpact(
            projection.data.months.map((m) => ({
              month: m.month,
              closingBalance: m.closingBalance,
            })),
            outflows,
          )
        : null,
    [projection.data, outflows],
  );

  const opp = rateOf(opportunity);
  const compare =
    offer && cashPrice > 0 && opp !== null
      ? cashVsInstallments({
          cashPrice,
          installmentAmount: offer.installmentAmount,
          installments: n,
          opportunityRate: opp,
        })
      : null;

  return (
    <>
      <section className="card card--pad form" aria-labelledby="sim-buy">
        <h2 id="sim-buy">E se eu comprar parcelado?</h2>
        <div className="field">
          <label htmlFor="sim-price">Preço do produto</label>
          <MoneyInput id="sim-price" large value={price} onChange={setPrice} />
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="sim-n">Parcelas</label>
            <IntegerInput id="sim-n" min={1} max={120} value={n} onChange={setN} />
          </div>
          <div className="field">
            <label htmlFor="sim-card">Onde vai pagar</label>
            <select
              id="sim-card"
              className="input"
              value={cardId}
              onChange={(e) => setCardId(e.target.value)}
            >
              <option value="">Boleto/carnê (a partir do mês que vem)</option>
              {(cards.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="segmented" role="group" aria-label="Como informar">
          {(
            [
              ['free', 'Sem juros'],
              ['rate', 'Sei os juros'],
              ['amount', 'Sei a parcela'],
            ] as const
          ).map(([v, label]) => (
            <button key={v} type="button" aria-pressed={how === v} onClick={() => setHow(v)}>
              {label}
            </button>
          ))}
        </div>
        {how === 'rate' && (
          <div className="field">
            <label htmlFor="sim-rate">Juros ao mês (%)</label>
            <input
              id="sim-rate"
              className="input num"
              inputMode="decimal"
              placeholder="Ex.: 2,5"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
            />
          </div>
        )}
        {how === 'amount' && (
          <div className="field">
            <label htmlFor="sim-amount">Valor de cada parcela</label>
            <MoneyInput id="sim-amount" value={amount} onChange={setAmount} />
          </div>
        )}
      </section>

      {offer && (
        <section className="card card--pad stack sim-hero" aria-labelledby="sim-result">
          <h2 id="sim-result" className="sr-only">
            Resultado
          </h2>
          <p className="sim-hero__main">
            <span className="muted">Você paga</span>
            <strong className="num">
              {n}x de {money(offer.installmentAmount, hidden)}
            </strong>
          </p>
          <dl className="sim-stats">
            <div>
              <dt>Total</dt>
              <dd className="num">{money(offer.total, hidden)}</dd>
            </div>
            <div>
              <dt>Juros</dt>
              <dd className={`num ${offer.interest > 0 ? 'expense' : ''}`}>
                {offer.interest > 0 ? money(offer.interest, hidden) : 'nenhum'}
              </dd>
            </div>
            {offer.interest > 0 && (
              <div>
                <dt>Taxa</dt>
                <dd className="num">{pctText(offer.monthlyRate)}</dd>
              </div>
            )}
          </dl>

          <div className="sim-verdict" aria-live="polite">
            {projection.isPending && <div className="skeleton" style={{ height: 48 }} />}
            {projection.isError && (
              <p className="alert alert--error" role="alert">
                {errorText(projection.error)}
              </p>
            )}
            {impact?.firstNewNegative ? (
              <p className="alert alert--error" role="alert">
                Seu saldo previsto fica{' '}
                <strong>negativo em {monthLabel(impact.firstNewNegative)}</strong> por causa dessa
                compra.
              </p>
            ) : impact?.lowest ? (
              <p>
                Com a compra, o menor saldo previsto é{' '}
                <strong className="num">{money(impact.lowest.balance, hidden)}</strong> em{' '}
                {monthLabel(impact.lowest.month)}.
              </p>
            ) : null}
          </div>

          {impact && (
            <details className="table-view sim-details">
              <summary>Ver mês a mês</summary>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Mês</th>
                      <th scope="col">Parcela</th>
                      <th scope="col" className="hide-sm">
                        Sem a compra
                      </th>
                      <th scope="col">Saldo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {impact.months.map((m) => (
                      <tr key={m.month}>
                        <th scope="row">{monthLabel(m.month)}</th>
                        <td className="num">{m.outflow ? money(-m.outflow, hidden) : '—'}</td>
                        <td className="num hide-sm">{money(m.before, hidden)}</td>
                        <td className={`num ${m.after < 0 ? 'expense' : ''}`}>
                          {money(m.after, hidden)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="muted">
                Saldo previsto do Planejamento com a compra.
                {cardId
                  ? ' As parcelas caem na fatura de cada mês.'
                  : ' Sem cartão, uma parcela por mês a partir do mês que vem.'}
              </p>
            </details>
          )}
        </section>
      )}

      {offer && (
        <details className="card card--pad sim-compare">
          <summary>Comparar com o preço à vista</summary>
          <div className="form">
            <div className="field-row">
              <div className="field">
                <label htmlFor="sim-cash-price">Preço à vista</label>
                <MoneyInput id="sim-cash-price" value={cashPrice} onChange={setCashPrice} />
              </div>
              <div className="field">
                <label htmlFor="sim-opp">Rendimento (% ao mês)</label>
                <input
                  id="sim-opp"
                  className="input num"
                  inputMode="decimal"
                  value={opportunity}
                  onChange={(e) => setOpportunity(e.target.value)}
                />
              </div>
            </div>
            {compare ? (
              <p role="status">
                {compare.cheaper === 'tie' ? (
                  'Dá no mesmo.'
                ) : compare.cheaper === 'cash' ? (
                  <>
                    <strong>À vista compensa.</strong> As parcelas valem{' '}
                    {money(compare.presentValue, hidden)} hoje, mais que os{' '}
                    {money(compare.cashPrice, hidden)} à vista: economia de{' '}
                    {money(compare.difference, hidden)}.
                  </>
                ) : (
                  <>
                    <strong>Parcelar compensa.</strong> As parcelas valem{' '}
                    {money(compare.presentValue, hidden)} hoje, menos que os{' '}
                    {money(compare.cashPrice, hidden)} à vista: economia de{' '}
                    {money(-compare.difference, hidden)}, se o dinheiro render isso.
                  </>
                )}
              </p>
            ) : (
              <p className="muted">Informe o preço à vista para comparar.</p>
            )}
            <p className="muted">
              Para o à vista valer a pena, o desconto precisa passar de{' '}
              {compare ? `${(compare.breakEvenDiscount * 100).toFixed(1).replace('.', ',')}%` : '—'}{' '}
              sobre o total parcelado.
            </p>
          </div>
        </details>
      )}
    </>
  );
}

function DebtSimulator() {
  const { hidden } = useHiddenValues();
  const debts = useDebts();
  const simulate = useSimulateDebt();
  const active = (debts.data ?? []).filter((d) => d.status === 'active' && d.direction === 'i_owe');
  const [debtId, setDebtId] = useState('');
  const [extra, setExtra] = useState(0);
  const id = debtId || active[0]?.id || '';
  const result = simulate.data;

  const scenario = (
    title: string,
    hint: string,
    s: { count: number; installment: number; lastDueDate: string | null; interestSaved: number },
  ) => (
    <div className="card card--pad stack sim-scenario">
      <div>
        <h3>{title}</h3>
        <span className="muted">{hint}</span>
      </div>
      <p className="sim-hero__main">
        <span className="muted">Você economiza</span>
        <strong className="num income">{money(s.interestSaved, hidden)}</strong>
      </p>
      <dl className="sim-stats">
        <div>
          <dt>Parcelas</dt>
          <dd className="num">{s.count}</dd>
        </div>
        <div>
          <dt>Parcela</dt>
          <dd className="num">{money(s.installment, hidden)}</dd>
        </div>
        <div>
          <dt>Termina</dt>
          <dd className="num">{s.lastDueDate ? formatDate(s.lastDueDate) : '—'}</dd>
        </div>
      </dl>
    </div>
  );

  return (
    <>
      <section className="card card--pad form" aria-labelledby="sim-debt">
        <h2 id="sim-debt">E se eu quitar ou amortizar uma dívida?</h2>
        {debts.isSuccess && active.length === 0 && (
          <p className="muted">Você não tem dívidas ativas para simular.</p>
        )}
        {active.length > 0 && (
          <form
            className="form"
            onSubmit={(e) => {
              e.preventDefault();
              simulate.mutate({ id, ...(extra > 0 ? { amount: extra } : {}) });
            }}
          >
            <div className="field">
              <label htmlFor="sim-debt-id">Dívida</label>
              <select
                id="sim-debt-id"
                className="input"
                value={id}
                onChange={(e) => {
                  setDebtId(e.target.value);
                  simulate.reset();
                }}
              >
                {active.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="sim-extra">Valor extra a pagar agora (opcional)</label>
              <MoneyInput id="sim-extra" value={extra} onChange={setExtra} />
              <p className="muted">
                Funciona em dívidas Price ou SAC. Sem valor, mostra só quanto custa quitar hoje.
              </p>
            </div>
            <button type="submit" className="btn btn--primary" disabled={simulate.isPending}>
              Simular
            </button>
          </form>
        )}
        {simulate.isError && (
          <p className="alert alert--error" role="alert">
            {errorText(simulate.error)}
          </p>
        )}
      </section>

      {result && (
        <>
          <section className="card card--pad stack sim-hero" aria-labelledby="sim-pay">
            <h2 id="sim-pay" className="sr-only">
              Quitar tudo hoje
            </h2>
            <p className="sim-hero__main">
              <span className="muted">Quitar tudo hoje custa</span>
              <strong className="num">{money(result.payoff.pay, hidden)}</strong>
            </p>
            <dl className="sim-stats">
              <div>
                <dt>Em parcelas</dt>
                <dd className="num">{money(result.current.remainingAmount, hidden)}</dd>
              </div>
              <div>
                <dt>Você economiza</dt>
                <dd className="num income">{money(result.payoff.saves, hidden)}</dd>
              </div>
              <div>
                <dt>Parcelas</dt>
                <dd className="num">{result.current.remainingCount}</dd>
              </div>
            </dl>
            <p className="muted">
              O saldo devedor não inclui os juros futuros. Para quitar de verdade, use a tela da
              dívida.
            </p>
          </section>
          {result.amortization && (
            <section className="stack" aria-labelledby="sim-amort">
              <h2 id="sim-amort">Pagando {money(result.amortization.amount, hidden)} a mais</h2>
              <p className="muted">{result.amortization.phaseName}</p>
              <div className="sim-scenarios">
                {scenario(
                  'Menos parcelas',
                  'Mantém o valor da parcela',
                  result.amortization.reduceTerm,
                )}
                {scenario('Parcela menor', 'Mantém o prazo', result.amortization.reduceInstallment)}
              </div>
            </section>
          )}
        </>
      )}
    </>
  );
}

/** Simuladores: compra parcelada e quitação antecipada. Nada é gravado. */
export function SimulatorsPage() {
  const [tab, setTab] = useState<Tab>('purchase');
  return (
    <>
      <PageHeader title="Simuladores" back="/mais" />
      <div className="segmented" role="group" aria-label="Simulador">
        <button type="button" aria-pressed={tab === 'purchase'} onClick={() => setTab('purchase')}>
          Compra parcelada
        </button>
        <button type="button" aria-pressed={tab === 'debt'} onClick={() => setTab('debt')}>
          Quitar dívida
        </button>
      </div>
      <p className="muted">Só simula: nada é lançado nem alterado.</p>
      {tab === 'purchase' ? <PurchaseSimulator /> : <DebtSimulator />}
    </>
  );
}
