import type { DebtDetail, DebtInstallmentDto } from '@finapp/shared';
import { useState } from 'react';
import { MoneyInput } from '../../components/MoneyInput';
import { useToast } from '../../components/Toast';
import { today } from '../../lib/dates';
import { formatDate, money } from '../../lib/format';
import {
  useDebtActions,
  useIndexValues,
  usePropertyActions,
  useSyncIndexValues,
} from '../../lib/queries';
import { errorText } from '../transactions/EntryForm';

const percent = (text: string) => Number(text.replace(',', '.')) / 100;

/** Pagar uma parcela (valor, data e, se for adiantada, desconto por taxa). @see RN 6.3, 6.5 */
export function PayInstallmentForm({
  debtId,
  inst,
  onDone,
}: {
  debtId: string;
  inst: DebtInstallmentDto;
  onDone: () => void;
}) {
  const { pay } = useDebtActions(debtId);
  const toast = useToast();
  const open = inst.amount - inst.paidAmount - inst.discount;
  const [amount, setAmount] = useState(open);
  const [date, setDate] = useState(today());
  const [rate, setRate] = useState('');
  const future = inst.dueDate.slice(0, 7) > today().slice(0, 7);
  return (
    <form
      className="tx__real"
      onSubmit={(e) => {
        e.preventDefault();
        pay.mutate(
          rate
            ? { number: inst.number, date, discountMonthlyRate: percent(rate) }
            : { number: inst.number, date, amount },
          {
            onSuccess: () => {
              toast({ text: `Parcela ${inst.number} paga.` });
              onDone();
            },
          },
        );
      }}
    >
      {pay.isError && (
        <p className="alert alert--error" role="alert">
          {errorText(pay.error)}
        </p>
      )}
      <label htmlFor={`pay-${inst.id}`} className="muted">
        Valor pago (parcela: {money(open)})
      </label>
      <MoneyInput
        id={`pay-${inst.id}`}
        value={amount}
        onChange={setAmount}
        replaceOnType
        autoFocus
      />
      <label htmlFor={`date-${inst.id}`} className="muted">
        Data
      </label>
      <input
        id={`date-${inst.id}`}
        type="date"
        className="input"
        max={today()}
        value={date}
        onChange={(e) => e.target.value && setDate(e.target.value)}
      />
      {future && (
        <>
          <label htmlFor={`rate-${inst.id}`} className="muted">
            Pagando adiantado? Taxa mensal de desconto (%, opcional)
          </label>
          <input
            id={`rate-${inst.id}`}
            className="input num"
            inputMode="decimal"
            placeholder="Ex.: 1,5"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
          />
        </>
      )}
      <div className="form-actions">
        <button type="button" className="btn" onClick={onDone}>
          Cancelar
        </button>
        <button
          type="submit"
          className="btn btn--primary"
          disabled={pay.isPending || (!rate && amount <= 0)}
        >
          {rate ? 'Pagar com desconto' : `Pagar ${money(amount)}`}
        </button>
      </div>
    </form>
  );
}

/** Amortização extraordinária e quitação total. @see RN 6.5 */
export function DebtExtraActions({ d }: { d: DebtDetail }) {
  const { amortize, payoff } = useDebtActions(d.id);
  const toast = useToast();
  const amortizable = d.phases.filter(
    (p) => (p.system === 'price' || p.system === 'sac') && p.summary.remainingCount > 0,
  );
  const [amount, setAmount] = useState(0);
  const [mode, setMode] = useState<'reduce_term' | 'reduce_installment'>('reduce_term');
  const [phaseId, setPhaseId] = useState(amortizable[0]?.id ?? '');
  const owedToMe = d.direction === 'owed_to_me';

  return (
    <>
      {amortizable.length > 0 && (
        <form
          className="card card--pad form"
          onSubmit={(e) => {
            e.preventDefault();
            amortize.mutate(
              { amount, mode, phaseId },
              {
                onSuccess: (r) => {
                  setAmount(0);
                  toast({
                    text: `Amortização de ${money(amount)} lançada. Agora são ${r.summary.remainingCount} parcelas.`,
                  });
                },
              },
            );
          }}
        >
          <h3>Amortizar</h3>
          <p className="muted">
            Um valor extra abate o saldo devedor ({money(d.summary.outstandingPrincipal)}) e as
            parcelas pendentes são recalculadas.
          </p>
          {amortize.isError && (
            <p className="alert alert--error" role="alert">
              {errorText(amortize.error)}
            </p>
          )}
          {amortizable.length > 1 && (
            <div className="field">
              <label htmlFor="amortize-phase">Fase</label>
              <select
                id="amortize-phase"
                className="input"
                value={phaseId}
                onChange={(e) => setPhaseId(e.target.value)}
              >
                {amortizable.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="field">
            <label htmlFor="amortize-amount">Valor extra</label>
            <MoneyInput
              id="amortize-amount"
              value={amount}
              onChange={(v) => setAmount(Math.max(0, v))}
            />
          </div>
          <div className="segmented" role="group" aria-label="O que reduzir">
            <button
              type="button"
              aria-pressed={mode === 'reduce_term'}
              onClick={() => setMode('reduce_term')}
            >
              Menos parcelas
            </button>
            <button
              type="button"
              aria-pressed={mode === 'reduce_installment'}
              onClick={() => setMode('reduce_installment')}
            >
              Parcela menor
            </button>
          </div>
          <button type="submit" className="btn" disabled={amortize.isPending || amount <= 0}>
            Amortizar {amount > 0 ? money(amount) : ''}
          </button>
        </form>
      )}

      <section className="card card--pad form" aria-label="Quitar">
        <h3>{owedToMe ? 'Receber tudo' : 'Quitar'}</h3>
        <p className="muted">
          {owedToMe ? 'Receber' : 'Pagar'} hoje o saldo devedor de{' '}
          <strong className="num">{money(d.summary.outstandingPrincipal)}</strong> (sem os juros
          futuros) e encerrar as parcelas restantes.
          {d.summary.expectedPayoffDate
            ? ` Hoje a última parcela seria em ${formatDate(d.summary.expectedPayoffDate)}.`
            : ''}
        </p>
        {payoff.isError && (
          <p className="alert alert--error" role="alert">
            {errorText(payoff.error)}
          </p>
        )}
        <button
          type="button"
          className="btn btn--primary"
          disabled={payoff.isPending}
          onClick={() => {
            if (!window.confirm(`Quitar "${d.name}" com ${money(d.summary.outstandingPrincipal)}?`))
              return;
            payoff.mutate({}, { onSuccess: () => toast({ text: `"${d.name}" quitada.` }) });
          }}
        >
          {owedToMe ? 'Receber tudo' : 'Quitar dívida'}
        </button>
      </section>
    </>
  );
}

const INDEX_LABEL = { incc: 'INCC', ipca: 'IPCA', igpm: 'IGP-M' } as const;

/** Imóvel na planta: entrega das chaves, juros de obra do mês e correção por índice. @see RN 6.2, 6.7 */
export function PropertyActions({ d }: { d: DebtDetail }) {
  const { completion, value, index } = usePropertyActions(d.id);
  const toast = useToast();
  const [date, setDate] = useState(d.completionDate ?? '');
  const variable = d.phases.find((p) => p.system === 'variable');
  const openMonths = variable
    ? d.installments
        .filter((i) => i.phaseId === variable.id && i.status !== 'paid')
        .map((i) => i.dueDate.slice(0, 7))
    : [];
  const [month, setMonth] = useState(openMonths[0] ?? '');
  const [amount, setAmount] = useState(0);
  const indexed = d.phases.filter((p) => p.index !== 'none' && p.summary.remainingCount > 0);
  const [phaseId, setPhaseId] = useState(indexed[0]?.id ?? '');
  const [indexMonth, setIndexMonth] = useState(today().slice(0, 7));
  const [indexValue, setIndexValue] = useState('');
  const indexedPhase = indexed.find((p) => p.id === phaseId);
  const indexValues = useIndexValues();
  const syncIndexes = useSyncIndexValues();
  const available = indexValues.data?.find(
    (v) => v.index === indexedPhase?.index && v.month === indexMonth,
  );
  // Sem nada digitado, mostra o valor que o app já buscou para o mês.
  const shownValue =
    indexValue !== ''
      ? indexValue
      : available
        ? (Math.round(available.value * 10_000) / 100).toString().replace('.', ',')
        : '';
  const error = completion.error ?? value.error ?? index.error;

  return (
    <section className="card card--pad form" aria-labelledby="property-title">
      <h3 id="property-title">Imóvel</h3>
      {Boolean(error) && (
        <p className="alert alert--error" role="alert">
          {errorText(error)}
        </p>
      )}
      {d.completionDate && !d.completionConfirmed && (
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            completion.mutate(
              { completionDate: date },
              {
                onSuccess: () =>
                  toast({
                    text: `Previsão alterada para ${formatDate(date)}. Cronograma refeito.`,
                  }),
              },
            );
          }}
        >
          <div className="field">
            <label htmlFor="completion-date">Previsão de entrega</label>
            <input
              id="completion-date"
              type="date"
              className="input"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
            <span className="muted field-hint">
              É uma estimativa
              {d.completionDeadline
                ? ` (o contrato vai até ${formatDate(d.completionDeadline)})`
                : ''}
              . Os juros de obra vão até ela e o financiamento começa no mês seguinte.
            </span>
          </div>
          <div className="form-actions">
            <button
              type="submit"
              className="btn"
              disabled={!date || date === d.completionDate || completion.isPending}
            >
              Mudar previsão
            </button>
            <button
              type="button"
              className="btn btn--primary"
              disabled={completion.isPending}
              onClick={() => {
                const real = today();
                if (!window.confirm(`Confirmar a entrega das chaves em ${formatDate(real)}?`))
                  return;
                completion.mutate(
                  { completionDate: real, confirmed: true },
                  {
                    onSuccess: () =>
                      toast({
                        text: 'Chaves recebidas! Os juros de obra param e o financiamento começa no mês que vem.',
                      }),
                  },
                );
              }}
            >
              Recebi as chaves
            </button>
          </div>
        </form>
      )}
      {d.completionConfirmed && d.completionDate && (
        <p className="muted">Chaves recebidas em {formatDate(d.completionDate)}.</p>
      )}

      {variable && openMonths.length > 0 && (
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            value.mutate(
              { phaseId: variable.id, month, amount },
              { onSuccess: () => toast({ text: `${variable.name}: valor de ${month} salvo.` }) },
            );
          }}
        >
          <div className="field-row">
            <div className="field">
              <label htmlFor="value-month">{variable.name}: mês</label>
              <select
                id="value-month"
                className="input"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
              >
                {openMonths.map((m) => (
                  <option key={m} value={m}>
                    {m.slice(5)}/{m.slice(0, 4)}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="value-amount">Valor real</label>
              <MoneyInput
                id="value-amount"
                value={amount}
                onChange={(v) => setAmount(Math.max(0, v))}
              />
            </div>
          </div>
          <button type="submit" className="btn" disabled={!month || amount <= 0 || value.isPending}>
            Salvar valor do mês
          </button>
        </form>
      )}

      {indexed.length > 0 && indexedPhase && (
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            index.mutate(
              {
                phaseId,
                index: indexedPhase.index as 'incc' | 'ipca' | 'igpm',
                month: indexMonth,
                value: percent(shownValue),
              },
              {
                onSuccess: () => {
                  setIndexValue('');
                  toast({
                    text: `${indexedPhase.name} corrigida pelo ${INDEX_LABEL[indexedPhase.index as 'incc']}.`,
                  });
                },
              },
            );
          }}
        >
          {indexed.length > 1 && (
            <div className="field">
              <label htmlFor="index-phase">Fase</label>
              <select
                id="index-phase"
                className="input"
                value={phaseId}
                onChange={(e) => setPhaseId(e.target.value)}
              >
                {indexed.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({INDEX_LABEL[p.index as 'incc']})
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="field-row">
            <div className="field">
              <label htmlFor="index-month">
                {INDEX_LABEL[indexedPhase.index as 'incc']} do mês
              </label>
              <input
                id="index-month"
                type="month"
                className="input"
                value={indexMonth}
                onChange={(e) => setIndexMonth(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="index-value">Variação (%)</label>
              <input
                id="index-value"
                className="input num"
                inputMode="decimal"
                placeholder="Ex.: 0,45"
                value={shownValue}
                onChange={(e) => setIndexValue(e.target.value)}
              />
            </div>
          </div>
          <span className="muted field-hint">
            {available
              ? available.source === 'auto'
                ? `Valor buscado no ${indexedPhase.index === 'ipca' ? 'IBGE' : 'Banco Central'}. Pode trocar se quiser.`
                : 'Valor que você mesmo cadastrou.'
              : 'Ainda não há valor deste mês: busque abaixo ou digite.'}{' '}
            Corrige as parcelas pendentes de {indexedPhase.name} que vencem a partir desse mês. As
            pagas não mudam.
          </span>
          <button
            type="button"
            className="btn btn--ghost"
            disabled={syncIndexes.isPending}
            onClick={() =>
              syncIndexes.mutate(undefined, {
                onSuccess: (r) => {
                  const failed = Object.keys(r.errors).length;
                  const saved = r.saved.incc + r.saved.ipca + r.saved.igpm;
                  toast({
                    text: failed
                      ? `Não consegui buscar ${failed === 3 ? 'nenhum índice' : 'todos os índices'}. Tente de novo mais tarde ou digite.`
                      : saved
                        ? 'Índices atualizados.'
                        : 'Os índices já estão em dia.',
                  });
                },
              })
            }
          >
            {syncIndexes.isPending ? 'Buscando…' : 'Buscar índices no Banco Central/IBGE'}
          </button>
          <button
            type="submit"
            className="btn"
            disabled={!indexMonth || shownValue.trim() === '' || index.isPending}
          >
            Aplicar correção
          </button>
        </form>
      )}
    </section>
  );
}
