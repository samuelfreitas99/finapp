import { addMonths, todayIn } from '@finapp/core';
import type { DebtBody, DebtKind, DebtSystem } from '@finapp/shared';
import { Plus, X } from 'lucide-react';
import { useDeferredValue, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { MoneyInput } from '../../components/MoneyInput';
import { PageHeader } from '../../components/PageHeader';
import { useToast } from '../../components/Toast';
import { DEBT_KIND_META, DEBT_SYSTEM_LABEL } from '../../lib/debts';
import { formatDate, money } from '../../lib/format';
import { useAccounts, useCards, useDebtMutations, useDebtPreview } from '../../lib/queries';
import { CARD_PREFIX, errorText, isCardTarget } from '../transactions/EntryForm';

type Index = 'none' | 'incc' | 'ipca' | 'igpm';

interface PhaseState {
  name: string;
  system: DebtSystem;
  firstDueDate: string;
  installments: number;
  installmentAmount: number;
  principal: number;
  ratePercent: string;
  rateBase: 'monthly' | 'annual';
  monthlyValue: number;
  lastMonth: string;
  endsAtCompletion: boolean;
  startsAfterCompletion: boolean;
  index: Index;
  payments: { dueDate: string; amount: number }[];
}

interface FormState {
  kind: DebtKind;
  direction: 'i_owe' | 'owed_to_me';
  name: string;
  institution: string;
  target: string;
  completionDate: string;
  assetValue: number;
  paidInstallments: number;
  phases: PhaseState[];
}

const KINDS: DebtKind[] = [
  'bank_loan',
  'financing',
  'property',
  'personal_loan',
  'card_loan',
  'third_party_card',
  'agreement',
  'consortium',
  'other',
];

const nextMonthDay = (day = 10) => {
  const t = todayIn();
  const next = addMonths(t, 1);
  return `${next.slice(0, 8)}${String(day).padStart(2, '0')}`;
};

const phase = (over: Partial<PhaseState> = {}): PhaseState => ({
  name: 'Parcelas',
  system: 'fixed',
  firstDueDate: nextMonthDay(),
  installments: 12,
  installmentAmount: 0,
  principal: 0,
  ratePercent: '',
  rateBase: 'monthly',
  monthlyValue: 0,
  lastMonth: '',
  endsAtCompletion: false,
  startsAfterCompletion: false,
  index: 'none',
  payments: [{ dueDate: nextMonthDay(20), amount: 0 }],
  ...over,
});

/** Modelo do imóvel na planta (RN 6.7): entrada, intermediárias, juros de obra e financiamento. */
const PROPERTY_PHASES = (): PhaseState[] => [
  phase({ name: 'Entrada', system: 'fixed', installments: 24, index: 'incc' }),
  phase({ name: 'Intermediárias', system: 'balloon' }),
  phase({ name: 'Juros de obra', system: 'variable', endsAtCompletion: true }),
  phase({
    name: 'Financiamento',
    system: 'price',
    installments: 360,
    rateBase: 'annual',
    startsAfterCompletion: true,
    index: 'ipca',
  }),
];

const rateValue = (p: PhaseState) => Number(p.ratePercent.replace(',', '.')) / 100;

function phaseBody(p: PhaseState) {
  const base = {
    name: p.name.trim() || 'Parcelas',
    system: p.system,
    firstDueDate: p.firstDueDate,
    index: p.index,
  };
  switch (p.system) {
    case 'fixed':
      return {
        ...base,
        installments: p.installments,
        installmentAmount: p.installmentAmount,
        startsAfterCompletion: p.startsAfterCompletion,
      };
    case 'price':
    case 'sac':
      return {
        ...base,
        principal: p.principal,
        installments: p.installments,
        ...(p.rateBase === 'monthly'
          ? { rateMonthly: rateValue(p) }
          : { rateAnnual: rateValue(p) }),
        startsAfterCompletion: p.startsAfterCompletion,
      };
    case 'variable':
      return {
        ...base,
        values: [{ month: p.firstDueDate.slice(0, 7), amount: p.monthlyValue }],
        endsAtCompletion: p.endsAtCompletion,
        ...(p.endsAtCompletion || !p.lastMonth ? {} : { lastMonth: p.lastMonth }),
      };
    case 'balloon':
      return { ...base, payments: p.payments.filter((x) => x.amount > 0) };
  }
}

function phaseReady(p: PhaseState, hasCompletion: boolean): boolean {
  switch (p.system) {
    case 'fixed':
      return p.installments > 0 && p.installmentAmount > 0;
    case 'price':
    case 'sac':
      return (
        p.principal > 0 && p.installments > 0 && p.ratePercent.trim() !== '' && rateValue(p) >= 0
      );
    case 'variable':
      return p.monthlyValue > 0 && (p.endsAtCompletion ? hasCompletion : Boolean(p.lastMonth));
    case 'balloon':
      return p.payments.some((x) => x.amount > 0);
  }
}

function toBody(f: FormState): DebtBody {
  const card = isCardTarget(f.target) ? f.target.slice(CARD_PREFIX.length) : null;
  return {
    name: f.name.trim() || DEBT_KIND_META[f.kind].label,
    kind: f.kind,
    direction: f.direction,
    institution: f.institution.trim() || null,
    ...(card ? { paymentCardId: card } : f.target ? { paymentAccountId: f.target } : {}),
    completionDate: f.kind === 'property' && f.completionDate ? f.completionDate : null,
    assetValue: f.kind === 'property' && f.assetValue > 0 ? f.assetValue : null,
    paidInstallments: f.paidInstallments,
    phases: f.phases.map(phaseBody),
  };
}

function PhaseEditor({
  p,
  i,
  isProperty,
  canRemove,
  onChange,
  onRemove,
}: {
  p: PhaseState;
  i: number;
  isProperty: boolean;
  canRemove: boolean;
  onChange: (next: Partial<PhaseState>) => void;
  onRemove: () => void;
}) {
  const id = (k: string) => `phase-${i}-${k}`;
  return (
    <fieldset className="part card card--pad">
      <legend className="sr-only">Fase {i + 1}</legend>
      <div className="field-row">
        <div className="field">
          <label htmlFor={id('name')}>Nome da fase</label>
          <input
            id={id('name')}
            className="input"
            maxLength={60}
            value={p.name}
            onChange={(e) => onChange({ name: e.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor={id('system')}>Como é calculada</label>
          <select
            id={id('system')}
            className="input"
            value={p.system}
            onChange={(e) => onChange({ system: e.target.value as DebtSystem })}
          >
            {(Object.keys(DEBT_SYSTEM_LABEL) as DebtSystem[]).map((s) => (
              <option key={s} value={s}>
                {DEBT_SYSTEM_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {p.system !== 'balloon' && (
        <div className="field">
          <label htmlFor={id('first')}>
            {p.startsAfterCompletion
              ? 'Dia de vencimento (começa depois da entrega)'
              : '1º vencimento'}
          </label>
          <input
            id={id('first')}
            type="date"
            className="input"
            value={p.firstDueDate}
            onChange={(e) => e.target.value && onChange({ firstDueDate: e.target.value })}
          />
        </div>
      )}

      {p.system === 'fixed' && (
        <div className="field-row">
          <div className="field">
            <label htmlFor={id('n')}>Parcelas</label>
            <input
              id={id('n')}
              className="input num"
              type="number"
              min={1}
              max={600}
              value={p.installments}
              onChange={(e) => onChange({ installments: Math.max(1, Number(e.target.value) || 1) })}
            />
          </div>
          <div className="field">
            <label htmlFor={id('amount')}>Valor da parcela</label>
            <MoneyInput
              id={id('amount')}
              value={p.installmentAmount}
              onChange={(v) => onChange({ installmentAmount: Math.max(0, v) })}
            />
          </div>
        </div>
      )}

      {(p.system === 'price' || p.system === 'sac') && (
        <>
          <div className="field">
            <label htmlFor={id('principal')}>Valor financiado</label>
            <MoneyInput
              id={id('principal')}
              value={p.principal}
              onChange={(v) => onChange({ principal: Math.max(0, v) })}
            />
          </div>
          <div className="field-row">
            <div className="field">
              <label htmlFor={id('rate')}>Juros (%)</label>
              <input
                id={id('rate')}
                className="input num"
                inputMode="decimal"
                placeholder="Ex.: 1,99"
                value={p.ratePercent}
                onChange={(e) => onChange({ ratePercent: e.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor={id('base')}>Taxa</label>
              <select
                id={id('base')}
                className="input"
                value={p.rateBase}
                onChange={(e) => onChange({ rateBase: e.target.value as 'monthly' | 'annual' })}
              >
                <option value="monthly">ao mês</option>
                <option value="annual">ao ano</option>
              </select>
            </div>
          </div>
          <div className="field">
            <label htmlFor={id('n2')}>Parcelas</label>
            <input
              id={id('n2')}
              className="input num"
              type="number"
              min={1}
              max={600}
              value={p.installments}
              onChange={(e) => onChange({ installments: Math.max(1, Number(e.target.value) || 1) })}
            />
          </div>
        </>
      )}

      {p.system === 'variable' && (
        <>
          <div className="field">
            <label htmlFor={id('monthly')}>Valor deste mês</label>
            <MoneyInput
              id={id('monthly')}
              value={p.monthlyValue}
              onChange={(v) => onChange({ monthlyValue: Math.max(0, v) })}
            />
            <span className="muted field-hint">
              Os meses seguintes usam este valor como estimativa até você informar o real.
            </span>
          </div>
          {isProperty ? (
            <label className="toggle">
              <input
                type="checkbox"
                checked={p.endsAtCompletion}
                onChange={(e) => onChange({ endsAtCompletion: e.target.checked })}
              />
              <span>
                <strong>Vai até a entrega das chaves</strong>
              </span>
            </label>
          ) : null}
          {!p.endsAtCompletion && (
            <div className="field">
              <label htmlFor={id('last')}>Último mês</label>
              <input
                id={id('last')}
                type="month"
                className="input"
                value={p.lastMonth}
                onChange={(e) => onChange({ lastMonth: e.target.value })}
              />
            </div>
          )}
        </>
      )}

      {p.system === 'balloon' && (
        <div className="parts">
          {p.payments.map((pay, k) => (
            <div key={k} className="field-row balloon-row">
              <div className="field">
                <label htmlFor={id(`pd-${k}`)}>Vencimento</label>
                <input
                  id={id(`pd-${k}`)}
                  type="date"
                  className="input"
                  value={pay.dueDate}
                  onChange={(e) =>
                    e.target.value &&
                    onChange({
                      payments: p.payments.map((x, j) =>
                        j === k ? { ...x, dueDate: e.target.value } : x,
                      ),
                    })
                  }
                />
              </div>
              <div className="field">
                <label htmlFor={id(`pa-${k}`)}>Valor</label>
                <MoneyInput
                  id={id(`pa-${k}`)}
                  value={pay.amount}
                  onChange={(v) =>
                    onChange({
                      payments: p.payments.map((x, j) =>
                        j === k ? { ...x, amount: Math.max(0, v) } : x,
                      ),
                    })
                  }
                />
              </div>
            </div>
          ))}
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => {
              const last = p.payments.at(-1)?.dueDate ?? nextMonthDay(20);
              onChange({
                payments: [
                  ...p.payments,
                  { dueDate: addMonths(last, 12), amount: p.payments.at(-1)?.amount ?? 0 },
                ],
              });
            }}
          >
            <Plus size={16} aria-hidden="true" />
            Mais uma (um ano depois)
          </button>
        </div>
      )}

      {isProperty && (p.system === 'fixed' || p.system === 'price' || p.system === 'sac') && (
        <label className="toggle">
          <input
            type="checkbox"
            checked={p.startsAfterCompletion}
            onChange={(e) => onChange({ startsAfterCompletion: e.target.checked })}
          />
          <span>
            <strong>Começa no mês seguinte à entrega das chaves</strong>
          </span>
        </label>
      )}

      <div className="field">
        <label htmlFor={id('index')}>Correção</label>
        <select
          id={id('index')}
          className="input"
          value={p.index}
          onChange={(e) => onChange({ index: e.target.value as Index })}
        >
          <option value="none">Sem correção</option>
          <option value="incc">INCC</option>
          <option value="ipca">IPCA</option>
          <option value="igpm">IGP-M</option>
        </select>
      </div>

      {canRemove && (
        <button type="button" className="btn btn--ghost" onClick={onRemove}>
          <X size={16} aria-hidden="true" />
          Remover fase
        </button>
      )}
    </fieldset>
  );
}

export function NewDebtPage() {
  const accounts = useAccounts();
  const cards = useCards();
  const { create } = useDebtMutations();
  const navigate = useNavigate();
  const toast = useToast();
  const [form, setForm] = useState<FormState>({
    kind: 'bank_loan',
    direction: 'i_owe',
    name: '',
    institution: '',
    target: '',
    completionDate: '',
    assetValue: 0,
    paidInstallments: 0,
    phases: [phase({ system: 'price' })],
  });
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));
  const setPhase = (i: number, next: Partial<PhaseState>) =>
    setForm((f) => ({ ...f, phases: f.phases.map((p, k) => (k === i ? { ...p, ...next } : p)) }));

  const isProperty = form.kind === 'property';
  const hasCompletion = Boolean(form.completionDate);
  const needsCompletion = form.phases.some((p) => p.endsAtCompletion || p.startsAfterCompletion);
  const ready =
    form.phases.every((p) => phaseReady(p, hasCompletion)) && (!needsCompletion || hasCompletion);
  const deferred = useDeferredValue(form);
  const preview = useDebtPreview(ready ? toBody(deferred) : null);

  const chooseKind = (kind: DebtKind) =>
    setForm((f) => ({
      ...f,
      kind,
      direction: kind === 'personal_loan' ? f.direction : 'i_owe',
      phases:
        kind === 'property'
          ? PROPERTY_PHASES()
          : f.kind === 'property'
            ? [
                phase({
                  system:
                    kind === 'personal_loan' || kind === 'third_party_card' ? 'fixed' : 'price',
                }),
              ]
            : f.phases,
      target:
        kind === 'card_loan'
          ? cards.data?.[0]
            ? `${CARD_PREFIX}${cards.data[0].id}`
            : ''
          : f.target,
    }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    create.mutate(toBody(form), {
      onSuccess: (d) => {
        toast({ text: `"${d.name}" cadastrada com ${d.summary.totalCount} parcelas.` });
        navigate(`/dividas/${d.id}`, { replace: true });
      },
    });
  };

  const rows = preview.data?.rows ?? [];
  const totalAmount = rows.reduce((s, r) => s + r.amount, 0);
  const totalInterest = rows.reduce((s, r) => s + r.interestPart, 0);

  return (
    <>
      <PageHeader title="Nova dívida" back="/dividas" />
      <form className="form" onSubmit={submit} noValidate>
        {create.isError && (
          <p className="alert alert--error" role="alert">
            {errorText(create.error)}
          </p>
        )}
        <section className="card card--pad form">
          <fieldset className="fieldset">
            <legend className="field-label">Tipo</legend>
            <div className="choice-grid">
              {KINDS.map((k) => {
                const meta = DEBT_KIND_META[k];
                const Icon = meta.icon;
                return (
                  <button
                    key={k}
                    type="button"
                    className="choice"
                    aria-pressed={form.kind === k}
                    onClick={() => chooseKind(k)}
                  >
                    <Icon size={20} aria-hidden="true" />
                    {meta.label}
                  </button>
                );
              })}
            </div>
          </fieldset>
          {form.kind === 'personal_loan' && (
            <div className="segmented" role="group" aria-label="Direção">
              <button
                type="button"
                aria-pressed={form.direction === 'i_owe'}
                onClick={() => set('direction', 'i_owe')}
              >
                Peguei emprestado
              </button>
              <button
                type="button"
                aria-pressed={form.direction === 'owed_to_me'}
                onClick={() => set('direction', 'owed_to_me')}
              >
                Emprestei
              </button>
            </div>
          )}
          <div className="field">
            <label htmlFor="name">Nome</label>
            <input
              id="name"
              className="input"
              maxLength={120}
              placeholder={isProperty ? 'Ex.: Apartamento' : 'Ex.: Empréstimo Caixa'}
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="institution">
              {form.kind === 'personal_loan' || form.kind === 'third_party_card'
                ? 'Com quem'
                : 'Banco ou empresa'}
            </label>
            <input
              id="institution"
              className="input"
              maxLength={120}
              value={form.institution}
              onChange={(e) => set('institution', e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="target">
              {form.direction === 'owed_to_me' ? 'Recebo na conta' : 'Pago com'}
            </label>
            <select
              id="target"
              className="input"
              value={form.target}
              onChange={(e) => set('target', e.target.value)}
            >
              <option value="">Só acompanhar (não lançar parcelas)</option>
              <optgroup label="Contas">
                {(accounts.data ?? []).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </optgroup>
              {form.direction === 'i_owe' && (cards.data ?? []).length > 0 && (
                <optgroup label="Cartões (parcelas na fatura)">
                  {(cards.data ?? []).map((c) => (
                    <option key={c.id} value={`${CARD_PREFIX}${c.id}`}>
                      {c.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            <span className="muted field-hint">
              Cada parcela vira um lançamento previsto e entra no Planejamento.
            </span>
          </div>
          {isProperty && (
            <div className="field-row">
              <div className="field">
                <label htmlFor="completion">Entrega das chaves</label>
                <input
                  id="completion"
                  type="date"
                  className="input"
                  value={form.completionDate}
                  onChange={(e) => set('completionDate', e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="asset">Valor do imóvel</label>
                <MoneyInput
                  id="asset"
                  value={form.assetValue}
                  onChange={(v) => set('assetValue', Math.max(0, v))}
                />
              </div>
            </div>
          )}
          <div className="field">
            <label htmlFor="paid">Parcelas já pagas</label>
            <input
              id="paid"
              className="input num"
              type="number"
              min={0}
              value={form.paidInstallments}
              onChange={(e) => set('paidInstallments', Math.max(0, Number(e.target.value) || 0))}
            />
            <span className="muted field-hint">
              Para dívidas que já estão em andamento (sem lançar nada).
            </span>
          </div>
        </section>

        <section className="stack" aria-label="Fases">
          <h2>{form.phases.length > 1 ? 'Fases' : 'Parcelas'}</h2>
          {form.phases.map((p, i) => (
            <PhaseEditor
              key={i}
              p={p}
              i={i}
              isProperty={isProperty}
              canRemove={form.phases.length > 1}
              onChange={(next) => setPhase(i, next)}
              onRemove={() =>
                set(
                  'phases',
                  form.phases.filter((_, k) => k !== i),
                )
              }
            />
          ))}
          {form.phases.length < 8 && (
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() =>
                set('phases', [...form.phases, phase({ name: `Fase ${form.phases.length + 1}` })])
              }
            >
              <Plus size={16} aria-hidden="true" />
              Adicionar fase
            </button>
          )}
        </section>

        {ready && (
          <section className="preview" aria-live="polite" aria-label="Prévia do cronograma">
            <h3>Prévia</h3>
            {preview.isError ? (
              <p className="field-error">{errorText(preview.error)}</p>
            ) : preview.data ? (
              <>
                <dl className="invoice-head__rows">
                  <div>
                    <dt>Parcelas</dt>
                    <dd className="num">{rows.length}</dd>
                  </div>
                  <div>
                    <dt>Total a pagar</dt>
                    <dd className="num">{money(totalAmount)}</dd>
                  </div>
                  {totalInterest > 0 && (
                    <div>
                      <dt>Juros no total</dt>
                      <dd className="num">{money(totalInterest)}</dd>
                    </div>
                  )}
                  {preview.data.summary.expectedPayoffDate && (
                    <div>
                      <dt>Última parcela</dt>
                      <dd>{formatDate(preview.data.summary.expectedPayoffDate)}</dd>
                    </div>
                  )}
                </dl>
                <ul className="preview__list">
                  {rows.slice(0, 5).map((r) => (
                    <li key={r.number}>
                      <span>
                        {r.number}. {formatDate(r.dueDate)}
                        {r.estimated ? ' (estimada)' : ''}
                      </span>
                      <strong className="num">{money(r.amount)}</strong>
                    </li>
                  ))}
                  {rows.length > 5 && (
                    <li>
                      <span>
                        … {rows.length}. {formatDate(rows.at(-1)?.dueDate ?? '')}
                      </span>
                      <strong className="num">{money(rows.at(-1)?.amount ?? 0)}</strong>
                    </li>
                  )}
                </ul>
              </>
            ) : null}
          </section>
        )}

        <button
          type="submit"
          className="btn btn--primary btn--block"
          disabled={!ready || create.isPending}
        >
          {create.isPending ? 'Salvando…' : 'Cadastrar dívida'}
        </button>
      </form>
    </>
  );
}
