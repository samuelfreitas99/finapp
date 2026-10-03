import type { DebtDetail, DebtInstallmentDto } from '@finapp/shared';
import { useState } from 'react';
import { MoneyInput } from '../../components/MoneyInput';
import { DecimalInput, IntegerInput } from '../../components/NumberInputs';
import { useToast } from '../../components/Toast';
import { today } from '../../lib/dates';
import { formatDate, money } from '../../lib/format';
import {
  useAccounts,
  useDebtActions,
  useDebtMutations,
  useIndexValues,
  usePropertyActions,
  useSyncIndexValues,
} from '../../lib/queries';
import { errorText } from '../transactions/EntryForm';

const percent = (text: string) => Number(text.replace(',', '.')) / 100;

/** O que falta pagar de uma parcela. */
export const openOf = (i: DebtInstallmentDto) => i.amount - i.paidAmount - i.discount;

/** Pagar uma parcela: valor, data e, se for antes do vencimento, desconto. @see RN 6.3, 6.5 */
export function PayInstallmentForm({
  debtId,
  inst,
  owedToMe = false,
  onDone,
}: {
  debtId: string;
  inst: DebtInstallmentDto;
  owedToMe?: boolean;
  onDone: () => void;
}) {
  const { pay } = useDebtActions(debtId);
  const toast = useToast();
  const open = openOf(inst);
  const [amount, setAmount] = useState(open);
  const [date, setDate] = useState(today());
  const [rate, setRate] = useState(0);
  const [gap, setGap] = useState<'discount' | 'partial'>('discount');
  const early = inst.dueDate > date;
  const short = amount > 0 && amount < open;
  // Pagou menos que a parcela antes do vencimento: em geral é o desconto que o banco deu.
  const discount = early && short && gap === 'discount' ? open - amount : 0;
  const verb = owedToMe ? 'Receber' : 'Pagar';
  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault();
        pay.mutate(
          rate && early
            ? { number: inst.number, date, discountMonthlyRate: rate / 100 }
            : { number: inst.number, date, amount, ...(discount ? { discount } : {}) },
          {
            onSuccess: () => {
              toast({ text: `Parcela ${inst.number} ${owedToMe ? 'recebida' : 'paga'}.` });
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
      <div className="field-row">
        <div className="field">
          <label htmlFor={`pay-${inst.id}`}>
            {owedToMe ? 'Quanto recebeu' : 'Quanto pagou'} (parcela: {money(open)})
          </label>
          <MoneyInput
            id={`pay-${inst.id}`}
            value={amount}
            onChange={(v) => setAmount(Math.max(0, v))}
            replaceOnType
            autoFocus
          />
        </div>
        <div className="field">
          <label htmlFor={`date-${inst.id}`}>Data</label>
          <input
            id={`date-${inst.id}`}
            type="date"
            className="input"
            max={today()}
            value={date}
            onChange={(e) => e.target.value && setDate(e.target.value)}
          />
        </div>
      </div>
      {short && early && !rate && (
        <fieldset className="fieldset">
          <legend className="field-label">E a diferença de {money(open - amount)}?</legend>
          <div className="segmented" role="group">
            <button
              type="button"
              aria-pressed={gap === 'discount'}
              onClick={() => setGap('discount')}
            >
              Foi desconto
            </button>
            <button
              type="button"
              aria-pressed={gap === 'partial'}
              onClick={() => setGap('partial')}
            >
              Ainda falta pagar
            </button>
          </div>
          <span className="muted field-hint">
            {gap === 'discount'
              ? 'Pagando antes do vencimento o banco costuma tirar os juros: a parcela fica quitada.'
              : 'A parcela fica parcial e o restante continua no planejamento.'}
          </span>
        </fieldset>
      )}
      {short && !early && (
        <span className="muted field-hint">
          A parcela fica parcial e o restante continua no planejamento.
        </span>
      )}
      {early && (
        <details className="entry__more">
          <summary>Sabe só a taxa de desconto?</summary>
          <div className="field">
            <label htmlFor={`rate-${inst.id}`}>Taxa mensal de desconto (%)</label>
            <DecimalInput
              id={`rate-${inst.id}`}
              placeholder="Ex.: 1,5"
              max={20}
              emptyWhenZero
              value={rate}
              onChange={setRate}
            />
            <span className="muted field-hint">
              O app calcula o desconto pelos meses de antecedência e ignora o valor acima.
            </span>
          </div>
        </details>
      )}
      <div className="form-actions">
        <button type="button" className="btn" onClick={onDone}>
          Cancelar
        </button>
        <button
          type="submit"
          className="btn btn--primary"
          disabled={pay.isPending || (!(rate && early) && amount <= 0)}
        >
          {rate && early
            ? `${verb} com desconto`
            : discount
              ? `${verb} ${money(amount)} (desconto de ${money(discount)})`
              : `${verb} ${money(amount)}`}
        </button>
      </div>
    </form>
  );
}

/** Conta de onde sai (ou onde entra) o dinheiro de uma ação da dívida. */
function AccountField({
  id,
  d,
  value,
  onChange,
}: {
  id: string;
  d: DebtDetail;
  value: string;
  onChange: (v: string) => void;
}) {
  const accounts = useAccounts();
  return (
    <div className="field">
      <label htmlFor={id}>
        {d.direction === 'owed_to_me' ? 'Entrou na conta' : 'Saiu da conta'}
      </label>
      <select id={id} className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Não lançar (só marcar como pago)</option>
        {(accounts.data ?? []).map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * Adiantar várias parcelas: das últimas (como os bancos costumam fazer) ou das próximas,
 * com o total que o banco cobrou. @see RN 6.5
 */
export function AdvanceForm({ d, onDone }: { d: DebtDetail; onDone: () => void }) {
  const { advance } = useDebtActions(d.id);
  const toast = useToast();
  const t = today();
  const candidates = d.installments
    .filter((i) => i.status !== 'paid' && i.paidAmount === 0 && i.dueDate > t)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const [count, setCount] = useState(1);
  const [from, setFrom] = useState<'last' | 'next'>('last');
  const [charged, setCharged] = useState<number | null>(null);
  const [rate, setRate] = useState(0);
  const [accountId, setAccountId] = useState(d.paymentAccountId ?? '');
  const owedToMe = d.direction === 'owed_to_me';

  if (candidates.length === 0) {
    return (
      <p className="muted">
        Não há parcelas futuras sem pagamento para adiantar. Para pagar a deste mês, use &quot;Pagar
        parcela&quot;.
      </p>
    );
  }
  const n = Math.min(count, candidates.length);
  const chosen = from === 'next' ? candidates.slice(0, n) : candidates.slice(-n);
  const sum = chosen.reduce((s, i) => s + openOf(i), 0);
  const total = charged ?? sum;
  const discount = rate ? null : sum - total;
  const first = chosen[0] as DebtInstallmentDto;
  const last = chosen.at(-1) as DebtInstallmentDto;

  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault();
        advance.mutate(
          {
            count: n,
            from,
            ...(rate ? { discountMonthlyRate: rate / 100 } : total < sum ? { total } : {}),
            ...(accountId ? { accountId } : {}),
          },
          {
            onSuccess: () => {
              toast({
                text: `${n} parcela${n > 1 ? 's' : ''} ${owedToMe ? 'recebida' : 'adiantada'}${n > 1 ? 's' : ''}.`,
              });
              onDone();
            },
          },
        );
      }}
    >
      {advance.isError && (
        <p className="alert alert--error" role="alert">
          {errorText(advance.error)}
        </p>
      )}
      <div className="field-row">
        <div className="field">
          <label htmlFor="adv-count">Quantas parcelas</label>
          <IntegerInput
            id="adv-count"
            min={1}
            max={candidates.length}
            value={count}
            onChange={(v) => {
              setCount(v);
              setCharged(null);
            }}
          />
        </div>
        <div className="field">
          <span className="field-label" id="adv-from">
            Quais
          </span>
          <div className="segmented" role="group" aria-labelledby="adv-from">
            <button
              type="button"
              aria-pressed={from === 'last'}
              onClick={() => {
                setFrom('last');
                setCharged(null);
              }}
            >
              As últimas
            </button>
            <button
              type="button"
              aria-pressed={from === 'next'}
              onClick={() => {
                setFrom('next');
                setCharged(null);
              }}
            >
              As próximas
            </button>
          </div>
        </div>
      </div>
      <p className="muted">
        {n > 1
          ? `Parcelas ${first.number} a ${last.number} (${formatDate(first.dueDate)} a ${formatDate(last.dueDate)})`
          : `Parcela ${first.number} (${formatDate(first.dueDate)})`}
        , somam <strong className="num">{money(sum)}</strong>.{' '}
        {from === 'last'
          ? 'Adiantando as últimas, o valor da parcela continua o mesmo e o contrato acaba antes.'
          : 'Adiantando as próximas, você fica sem parcelas a pagar nos próximos meses.'}
      </p>
      {!rate && (
        <div className="field">
          <label htmlFor="adv-total">{owedToMe ? 'Quanto recebeu' : 'Quanto o banco cobrou'}</label>
          <MoneyInput
            id="adv-total"
            value={total}
            onChange={(v) => setCharged(Math.max(0, v))}
            replaceOnType
          />
          <span className="muted field-hint">
            {discount && discount > 0
              ? `Desconto de ${money(discount)} pelos juros que deixam de existir.`
              : discount && discount < 0
                ? 'O valor passa da soma das parcelas.'
                : 'Se o banco deu desconto, digite o valor que ele mostrou.'}
          </span>
        </div>
      )}
      <details className="entry__more">
        <summary>Sabe só a taxa de desconto?</summary>
        <div className="field">
          <label htmlFor="adv-rate">Taxa mensal de desconto (%)</label>
          <DecimalInput
            id="adv-rate"
            placeholder="Ex.: 1,5"
            max={20}
            emptyWhenZero
            value={rate}
            onChange={setRate}
          />
          <span className="muted field-hint">
            Com a taxa, o app calcula o desconto de cada parcela pelos meses de antecedência.
          </span>
        </div>
      </details>
      <AccountField id="adv-account" d={d} value={accountId} onChange={setAccountId} />
      <div className="form-actions">
        <button type="button" className="btn" onClick={onDone}>
          Cancelar
        </button>
        <button
          type="submit"
          className="btn btn--primary"
          disabled={advance.isPending || (!rate && (total <= 0 || total > sum))}
        >
          {rate ? `Adiantar ${n} com desconto` : `Adiantar ${n} por ${money(total)}`}
        </button>
      </div>
    </form>
  );
}

/** Amortização extraordinária (Price/SAC). @see RN 6.5 */
export function AmortizeForm({ d, onDone }: { d: DebtDetail; onDone: () => void }) {
  const { amortize } = useDebtActions(d.id);
  const toast = useToast();
  const amortizable = d.phases.filter(
    (p) => (p.system === 'price' || p.system === 'sac') && p.summary.remainingCount > 0,
  );
  const [amount, setAmount] = useState(0);
  const [mode, setMode] = useState<'reduce_term' | 'reduce_installment'>('reduce_term');
  const [phaseId, setPhaseId] = useState(amortizable[0]?.id ?? '');
  const [accountId, setAccountId] = useState(d.paymentAccountId ?? '');

  if (amortizable.length === 0) {
    return (
      <p className="muted">
        Para amortizar, o app precisa saber os juros, e esta dívida foi cadastrada só com o valor
        das parcelas. O efeito é o mesmo de adiantar as últimas parcelas: use &quot;Adiantar&quot;
        com o valor que o banco cobrar.
      </p>
    );
  }
  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault();
        amortize.mutate(
          { amount, mode, phaseId, ...(accountId ? { accountId } : {}) },
          {
            onSuccess: (r) => {
              toast({
                text: `Amortização de ${money(amount)} lançada. Agora são ${r.summary.remainingCount} parcelas.`,
              });
              onDone();
            },
          },
        );
      }}
    >
      <p className="muted">
        Um valor extra abate o saldo devedor ({money(d.summary.outstandingPrincipal)}) e as parcelas
        que faltam são recalculadas.
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
          autoFocus
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
      <AccountField id="amortize-account" d={d} value={accountId} onChange={setAccountId} />
      <div className="form-actions">
        <button type="button" className="btn" onClick={onDone}>
          Cancelar
        </button>
        <button
          type="submit"
          className="btn btn--primary"
          disabled={amortize.isPending || amount <= 0}
        >
          Amortizar {amount > 0 ? money(amount) : ''}
        </button>
      </div>
    </form>
  );
}

/** Quitação total pelo saldo devedor. @see RN 6.5 */
export function PayoffForm({ d, onDone }: { d: DebtDetail; onDone: () => void }) {
  const { payoff } = useDebtActions(d.id);
  const toast = useToast();
  const [accountId, setAccountId] = useState(d.paymentAccountId ?? '');
  const owedToMe = d.direction === 'owed_to_me';
  const hasInterest = d.summary.outstandingPrincipal < d.summary.remainingAmount;
  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault();
        payoff.mutate(accountId ? { accountId } : {}, {
          onSuccess: () => {
            toast({ text: `"${d.name}" quitada.` });
            onDone();
          },
        });
      }}
    >
      <p>
        {owedToMe ? 'Receber' : 'Pagar'} hoje{' '}
        <strong className="num">{money(d.summary.outstandingPrincipal)}</strong> e encerrar as{' '}
        {d.summary.remainingCount} parcelas que faltam.
      </p>
      <p className="muted">
        {hasInterest
          ? `Sem os juros futuros: economia de ${money(d.summary.remainingAmount - d.summary.outstandingPrincipal)} em relação a pagar até o fim.`
          : 'Sem a taxa de juros cadastrada, o app não calcula desconto: o valor é a soma do que falta. Se o banco oferecer menos, use "Adiantar" com todas as parcelas e o valor cobrado.'}
      </p>
      {payoff.isError && (
        <p className="alert alert--error" role="alert">
          {errorText(payoff.error)}
        </p>
      )}
      <AccountField id="payoff-account" d={d} value={accountId} onChange={setAccountId} />
      <div className="form-actions">
        <button type="button" className="btn" onClick={onDone}>
          Cancelar
        </button>
        <button type="submit" className="btn btn--primary" disabled={payoff.isPending}>
          {owedToMe ? 'Receber tudo' : 'Quitar dívida'}
        </button>
      </div>
    </form>
  );
}

/** Dados cadastrais (o cronograma não muda). */
export function EditDebtForm({ d, onDone }: { d: DebtDetail; onDone: () => void }) {
  const { update } = useDebtMutations();
  const toast = useToast();
  const [name, setName] = useState(d.name);
  const [institution, setInstitution] = useState(d.institution ?? '');
  const [notes, setNotes] = useState(d.notes ?? '');
  const [assetValue, setAssetValue] = useState(d.assetValue ?? 0);
  const [deadline, setDeadline] = useState(d.completionDeadline ?? '');
  const isProperty = d.kind === 'property';
  const withWhom = d.kind === 'personal_loan' || d.kind === 'third_party_card';
  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault();
        update.mutate(
          {
            id: d.id,
            body: {
              name: name.trim(),
              institution: institution.trim() || null,
              notes: notes.trim() || null,
              ...(isProperty
                ? {
                    assetValue: assetValue > 0 ? assetValue : null,
                    completionDeadline: deadline || null,
                  }
                : {}),
            },
          },
          {
            onSuccess: () => {
              toast({ text: 'Dados salvos.' });
              onDone();
            },
          },
        );
      }}
    >
      {update.isError && (
        <p className="alert alert--error" role="alert">
          {errorText(update.error)}
        </p>
      )}
      <div className="field">
        <label htmlFor="edit-name">Nome</label>
        <input
          id="edit-name"
          className="input"
          maxLength={120}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="edit-institution">{withWhom ? 'Com quem' : 'Banco ou empresa'}</label>
        <input
          id="edit-institution"
          className="input"
          maxLength={120}
          value={institution}
          onChange={(e) => setInstitution(e.target.value)}
        />
      </div>
      {isProperty && (
        <div className="field-row">
          <div className="field">
            <label htmlFor="edit-asset">Valor do imóvel</label>
            <MoneyInput
              id="edit-asset"
              value={assetValue}
              onChange={(v) => setAssetValue(Math.max(0, v))}
            />
          </div>
          <div className="field">
            <label htmlFor="edit-deadline">Prazo do contrato</label>
            <input
              id="edit-deadline"
              type="date"
              className="input"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
            />
          </div>
        </div>
      )}
      <div className="field">
        <label htmlFor="edit-notes">Observações</label>
        <textarea
          id="edit-notes"
          className="input"
          rows={3}
          maxLength={2000}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>
      <span className="muted field-hint">
        Valores e datas das parcelas não mudam aqui: use Adiantar, Amortizar ou, se o cadastro
        estiver errado, cancele e cadastre de novo.
      </span>
      <div className="form-actions">
        <button type="button" className="btn" onClick={onDone}>
          Cancelar
        </button>
        <button
          type="submit"
          className="btn btn--primary"
          disabled={update.isPending || !name.trim()}
        >
          Salvar
        </button>
      </div>
    </form>
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
                ? 'Valor buscado nas fontes oficiais (IBGE, Banco Central ou Ipea). Pode trocar se quiser.'
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
            {syncIndexes.isPending ? 'Buscando…' : 'Buscar índices oficiais'}
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
