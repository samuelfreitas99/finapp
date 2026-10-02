import type { DebtDetail, DebtInstallmentDto } from '@finapp/shared';
import { useState } from 'react';
import { MoneyInput } from '../../components/MoneyInput';
import { useToast } from '../../components/Toast';
import { today } from '../../lib/dates';
import { formatDate, money } from '../../lib/format';
import { useDebtActions } from '../../lib/queries';
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
