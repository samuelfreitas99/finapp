import { addMonths, principalFromPayment, todayIn } from '@finapp/core';
import type { DebtBody, DebtKind, DebtSystem } from '@finapp/shared';
import { Plus, X } from 'lucide-react';
import { useDeferredValue, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { MoneyInput } from '../../components/MoneyInput';
import { IntegerInput } from '../../components/NumberInputs';
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
  /** Parte do modelo do imóvel na planta (só o que o contrato tiver entra no cadastro). */
  template?: PropertyPart;
  /** Entra no cadastro (no imóvel, a pessoa marca as partes que o contrato tem). */
  included: boolean;
}

type PropertyPart = 'down' | 'balloon' | 'construction' | 'financing';

/** Partes do imóvel na planta, na linguagem do contrato. @see RN 6.7 */
const PROPERTY_PART_TEXT: Record<PropertyPart, string> = {
  down: 'Parcelas mensais pagas direto à construtora durante a obra.',
  balloon: 'Parcelas maiores em datas marcadas: anuais, semestrais ou na entrega das chaves.',
  construction:
    'Cobrados pelo banco todo mês até a entrega das chaves (evolução de obra). O valor muda todo mês.',
  financing: 'O que o banco financia, pago depois que você recebe as chaves.',
};

interface FormState {
  kind: DebtKind;
  direction: 'i_owe' | 'owed_to_me';
  name: string;
  institution: string;
  target: string;
  /** Previsão de entrega (imóvel). */
  completionDate: string;
  /** Prazo do contrato para a entrega (pior caso). */
  completionDeadline: string;
  assetValue: number;
  /** Modo simples: "Começando agora" ou "Já estou pagando". */
  mode: 'new' | 'ongoing';
  /** Mostra o editor de fases (sistema, SAC, várias fases). */
  advanced: boolean;
  simple: SimpleState;
  /** Valor recebido (devo) ou emprestado (me devem) e onde entrou/saiu. */
  moneyAmount: number;
  moneyAccountId: string;
  phases: PhaseState[];
  /** Avançado/imóvel: parcelas já vencidas que a pessoa já pagou (preenchido ao salvar). */
  pastPaid: number;
  /** Avançado/imóvel: "já paguei as parcelas que venceram antes de hoje". */
  pastAllPaid: boolean;
}

interface SimpleState {
  count: number;
  installment: number;
  ratePercent: string;
  firstDue: string;
  left: number;
  nextDue: string;
  totalCount: number;
}

const MONEY_KINDS: DebtKind[] = ['bank_loan', 'card_loan', 'personal_loan', 'financing', 'other'];

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
  included: true,
  ...over,
});

/** Modelo do imóvel na planta (RN 6.7): entrada, intermediárias, juros de obra e financiamento. */
const PROPERTY_PHASES = (): PhaseState[] => [
  phase({
    name: 'Entrada',
    system: 'fixed',
    installments: 24,
    index: 'incc',
    template: 'down',
    included: false,
  }),
  phase({ name: 'Intermediárias', system: 'balloon', template: 'balloon', included: false }),
  phase({
    name: 'Juros de obra',
    system: 'variable',
    endsAtCompletion: true,
    template: 'construction',
    included: false,
  }),
  phase({
    name: 'Financiamento',
    system: 'sac',
    installments: 360,
    rateBase: 'annual',
    startsAfterCompletion: true,
    template: 'financing',
    included: false,
  }),
];

const includedPhases = (f: FormState) => f.phases.filter((p) => p.included);

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

const simpleRate = (s: SimpleState) =>
  s.ratePercent.trim() ? Number(s.ratePercent.replace(',', '.')) / 100 : null;

/** Fases do modo simples, a partir do que a pessoa vê no contrato ou no app do banco. */
function simplePhases(f: FormState): {
  phases: DebtBody['phases'];
  paidInstallments: number;
  principal?: number;
} {
  const s = f.simple;
  const rate = simpleRate(s);
  if (f.mode === 'ongoing') {
    if (rate !== null && rate > 0) {
      // Com a taxa, o saldo devedor sai do valor presente das parcelas que faltam.
      return {
        phases: [
          {
            name: 'Parcelas',
            system: 'price',
            principal: principalFromPayment(s.installment, rate, s.left),
            rateMonthly: rate,
            installments: s.left,
            firstDueDate: s.nextDue,
          },
        ],
        paidInstallments: 0,
      };
    }
    const done = Math.max(0, s.totalCount - s.left);
    return {
      phases: [
        {
          name: 'Parcelas',
          system: 'fixed',
          installments: done + s.left,
          installmentAmount: s.installment,
          firstDueDate: done ? addMonths(s.nextDue, -done) : s.nextDue,
        },
      ],
      paidInstallments: done,
    };
  }
  if (s.installment > 0) {
    return {
      phases: [
        {
          name: 'Parcelas',
          system: 'fixed',
          installments: s.count,
          installmentAmount: s.installment,
          firstDueDate: s.firstDue,
        },
      ],
      paidInstallments: 0,
    };
  }
  return {
    phases: [
      {
        name: 'Parcelas',
        system: 'price',
        principal: f.moneyAmount,
        rateMonthly: rate ?? 0,
        installments: s.count,
        firstDueDate: s.firstDue,
      },
    ],
    paidInstallments: 0,
    principal: f.moneyAmount,
  };
}

function simpleReady(f: FormState): boolean {
  const s = f.simple;
  if (f.mode === 'ongoing') return s.left > 0 && s.installment > 0 && Boolean(s.nextDue);
  if (!(s.count > 0 && s.firstDue)) return false;
  return s.installment > 0 || (simpleRate(s) !== null && f.moneyAmount > 0);
}

/** "Pago com" ainda não escolhido: usa a primeira conta (para as parcelas entrarem no Planejamento). */
const AUTO_TARGET = 'auto';

function toBody(f: FormState): DebtBody {
  const card = isCardTarget(f.target) ? f.target.slice(CARD_PREFIX.length) : null;
  const useSimple = f.kind !== 'property' && !f.advanced;
  const simple = useSimple ? simplePhases(f) : null;
  return {
    name: f.name.trim() || DEBT_KIND_META[f.kind].label,
    kind: f.kind,
    direction: f.direction,
    institution: f.institution.trim() || null,
    ...(card ? { paymentCardId: card } : f.target ? { paymentAccountId: f.target } : {}),
    completionDate: f.kind === 'property' && f.completionDate ? f.completionDate : null,
    completionDeadline: f.kind === 'property' && f.completionDeadline ? f.completionDeadline : null,
    assetValue: f.kind === 'property' && f.assetValue > 0 ? f.assetValue : null,
    paidInstallments: simple?.paidInstallments ?? f.pastPaid,
    ...(MONEY_KINDS.includes(f.kind) && f.moneyAccountId && f.moneyAmount > 0
      ? { moneyAccountId: f.moneyAccountId, principal: f.moneyAmount }
      : {}),
    phases: simple ? simple.phases : includedPhases(f).map(phaseBody),
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
      <legend className="sr-only">{p.template ? p.name : `Fase ${i + 1}`}</legend>
      {p.template && <h3>{p.name}</h3>}
      {p.template === 'financing' && (
        <div className="field">
          <span className="field-label" id={id('fin-system')}>
            Sistema do financiamento
          </span>
          <div className="segmented" role="group" aria-labelledby={id('fin-system')}>
            <button
              type="button"
              aria-pressed={p.system === 'sac'}
              onClick={() => onChange({ system: 'sac' })}
            >
              SAC
            </button>
            <button
              type="button"
              aria-pressed={p.system === 'price'}
              onClick={() => onChange({ system: 'price' })}
            >
              Price
            </button>
          </div>
          <span className="muted field-hint">
            Está no contrato. SAC: a parcela começa maior e vai caindo (comum na Caixa). Price: a
            parcela é igual todo mês.
          </span>
        </div>
      )}
      {!p.template && (
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
      )}

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
            <IntegerInput
              id={id('n')}
              min={1}
              max={600}
              value={p.installments}
              onChange={(v) => onChange({ installments: v })}
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
            <IntegerInput
              id={id('n2')}
              min={1}
              max={600}
              value={p.installments}
              onChange={(v) => onChange({ installments: v })}
            />
          </div>
        </>
      )}

      {p.system === 'variable' && (
        <>
          <div className="field">
            <label htmlFor={id('monthly')}>
              {p.template === 'construction' ? 'Valor do último boleto' : 'Valor deste mês'}
            </label>
            <MoneyInput
              id={id('monthly')}
              value={p.monthlyValue}
              onChange={(v) => onChange({ monthlyValue: Math.max(0, v) })}
            />
            <span className="muted field-hint">
              Os meses seguintes usam este valor como estimativa até você informar o real.
            </span>
          </div>
          {isProperty && p.template !== 'construction' ? (
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

      {isProperty &&
        !p.template &&
        (p.system === 'fixed' || p.system === 'price' || p.system === 'sac') && (
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
    target: AUTO_TARGET,
    completionDate: '',
    completionDeadline: '',
    assetValue: 0,
    mode: 'new',
    advanced: false,
    simple: {
      count: 12,
      installment: 0,
      ratePercent: '',
      firstDue: nextMonthDay(),
      left: 12,
      nextDue: nextMonthDay(),
      totalCount: 0,
    },
    moneyAmount: 0,
    moneyAccountId: '',
    phases: [phase({ system: 'price' })],
    pastPaid: 0,
    pastAllPaid: true,
  });
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));
  const setPhase = (i: number, next: Partial<PhaseState>) =>
    setForm((f) => ({ ...f, phases: f.phases.map((p, k) => (k === i ? { ...p, ...next } : p)) }));

  const isProperty = form.kind === 'property';
  const hasCompletion = Boolean(form.completionDate);
  const chosen = includedPhases(form);
  const needsCompletion = chosen.some((p) => p.endsAtCompletion || p.startsAfterCompletion);
  const useSimple = !isProperty && !form.advanced;
  const ready = useSimple
    ? simpleReady(form)
    : chosen.length > 0 &&
      chosen.every((p) => phaseReady(p, hasCompletion)) &&
      (!needsCompletion || hasCompletion);
  const setSimple = (next: Partial<SimpleState>) =>
    setForm((f) => ({ ...f, simple: { ...f.simple, ...next } }));
  const withTarget = (f: FormState): FormState =>
    f.target === AUTO_TARGET ? { ...f, target: accounts.data?.[0]?.id ?? '' } : f;
  const deferred = useDeferredValue(form);
  const preview = useDebtPreview(ready ? toBody(withTarget(deferred)) : null);

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
    create.mutate(toBody(withTarget({ ...form, pastPaid: form.pastAllPaid ? pastRows : 0 })), {
      onSuccess: (d) => {
        toast({ text: `"${d.name}" cadastrada com ${d.summary.totalCount} parcelas.` });
        navigate(`/dividas/${d.id}`, { replace: true });
      },
    });
  };

  const rows = preview.data?.rows ?? [];
  // Cadastro avançado/imóvel com começo no passado: as parcelas vencidas contam como pagas.
  const pastRows = useSimple ? 0 : rows.filter((r) => r.dueDate < todayIn()).length;
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
              value={withTarget(form).target}
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
              {form.direction === 'i_owe' &&
                form.kind !== 'third_party_card' &&
                (cards.data ?? []).length > 0 && (
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
              {withTarget(form).target
                ? 'Cada parcela vira um lançamento previsto e entra no Planejamento e nos avisos.'
                : 'Só acompanhar: as parcelas não entram no Planejamento nem nos avisos de vencimento.'}
            </span>
          </div>
          {MONEY_KINDS.includes(form.kind) && (form.mode === 'new' || form.advanced) && (
            <div className="field-row">
              <div className="field">
                <label htmlFor="money-amount">
                  {form.direction === 'owed_to_me' ? 'Valor emprestado' : 'Valor que recebi'}
                </label>
                <MoneyInput
                  id="money-amount"
                  value={form.moneyAmount}
                  onChange={(v) => set('moneyAmount', Math.max(0, v))}
                />
              </div>
              <div className="field">
                <label htmlFor="money-account">
                  {form.direction === 'owed_to_me' ? 'Saiu da conta' : 'Entrou na conta'}
                </label>
                <select
                  id="money-account"
                  className="input"
                  value={form.moneyAccountId}
                  onChange={(e) => set('moneyAccountId', e.target.value)}
                >
                  <option value="">Não lançar</option>
                  {(accounts.data ?? []).map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
          {isProperty && (
            <div className="field-row">
              <div className="field">
                <label htmlFor="completion">Previsão de entrega</label>
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
          {isProperty && (
            <div className="field">
              <label htmlFor="deadline">Prazo do contrato (opcional)</label>
              <input
                id="deadline"
                type="date"
                className="input"
                value={form.completionDeadline}
                onChange={(e) => set('completionDeadline', e.target.value)}
              />
              <span className="muted field-hint">
                A previsão é só uma estimativa: o cronograma usa ela até você tocar em &quot;Recebi
                as chaves&quot; no painel. O prazo do contrato é a data máxima.
              </span>
            </div>
          )}
        </section>

        {!isProperty && (
          <section className="card card--pad form" aria-label="Parcelas">
            <div className="segmented" role="group" aria-label="Situação">
              <button
                type="button"
                aria-pressed={form.mode === 'new'}
                onClick={() => set('mode', 'new')}
              >
                Começando agora
              </button>
              <button
                type="button"
                aria-pressed={form.mode === 'ongoing'}
                onClick={() => set('mode', 'ongoing')}
              >
                Já estou pagando
              </button>
            </div>
            {!form.advanced && form.mode === 'new' && (
              <>
                <div className="field-row">
                  <div className="field">
                    <label htmlFor="s-count">Quantas parcelas</label>
                    <IntegerInput
                      id="s-count"
                      min={1}
                      max={600}
                      value={form.simple.count}
                      onChange={(v) => setSimple({ count: v })}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="s-first">1ª parcela vence em</label>
                    <input
                      id="s-first"
                      type="date"
                      className="input"
                      value={form.simple.firstDue}
                      onChange={(e) => e.target.value && setSimple({ firstDue: e.target.value })}
                    />
                  </div>
                </div>
                <div className="field">
                  <label htmlFor="s-installment">Valor de cada parcela</label>
                  <MoneyInput
                    id="s-installment"
                    value={form.simple.installment}
                    onChange={(v) => setSimple({ installment: Math.max(0, v) })}
                  />
                  <span className="muted field-hint">
                    Não sabe? Deixe em branco e informe os juros ao mês e o valor que recebeu: o
                    FinApp calcula a parcela.
                  </span>
                </div>
                {form.simple.installment === 0 && (
                  <div className="field">
                    <label htmlFor="s-rate">Juros ao mês (%)</label>
                    <input
                      id="s-rate"
                      className="input num"
                      inputMode="decimal"
                      placeholder="Ex.: 1,99"
                      value={form.simple.ratePercent}
                      onChange={(e) => setSimple({ ratePercent: e.target.value })}
                    />
                  </div>
                )}
              </>
            )}
            {!form.advanced && form.mode === 'ongoing' && (
              <>
                <p className="muted">Use o que aparece no app do banco ou no boleto.</p>
                <div className="field-row">
                  <div className="field">
                    <label htmlFor="o-left">Quantas parcelas faltam</label>
                    <IntegerInput
                      id="o-left"
                      min={1}
                      max={600}
                      value={form.simple.left}
                      onChange={(v) => setSimple({ left: v })}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="o-next">Próximo vencimento</label>
                    <input
                      id="o-next"
                      type="date"
                      className="input"
                      value={form.simple.nextDue}
                      onChange={(e) => e.target.value && setSimple({ nextDue: e.target.value })}
                    />
                  </div>
                </div>
                <div className="field">
                  <label htmlFor="o-installment">Valor da parcela</label>
                  <MoneyInput
                    id="o-installment"
                    value={form.simple.installment}
                    onChange={(v) => setSimple({ installment: Math.max(0, v) })}
                  />
                </div>
                <details className="entry__more">
                  <summary>Sabe a taxa ou o total de parcelas? (opcional)</summary>
                  <div className="field-row">
                    <div className="field">
                      <label htmlFor="o-rate">Juros ao mês (%)</label>
                      <input
                        id="o-rate"
                        className="input num"
                        inputMode="decimal"
                        placeholder="Ex.: 1,99"
                        value={form.simple.ratePercent}
                        onChange={(e) => setSimple({ ratePercent: e.target.value })}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="o-total">Total de parcelas do contrato</label>
                      <IntegerInput
                        id="o-total"
                        min={0}
                        max={600}
                        emptyWhenZero
                        value={form.simple.totalCount}
                        onChange={(v) => setSimple({ totalCount: v })}
                      />
                    </div>
                  </div>
                  <span className="muted field-hint">
                    Com a taxa, o app calcula quanto custaria quitar hoje. Com o total, mostra o
                    progresso desde o começo.
                  </span>
                </details>
              </>
            )}
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => set('advanced', !form.advanced)}
            >
              {form.advanced
                ? 'Voltar ao modo simples'
                : 'Detalhes avançados (SAC, várias fases, intermediárias)'}
            </button>
          </section>
        )}

        {isProperty && (
          <section className="card card--pad form" role="group" aria-labelledby="parts-title">
            <h2 id="parts-title">O que o seu contrato tem?</h2>
            <p className="muted">
              Marque só as partes que aparecem no contrato. Cada uma abre os campos dela logo
              abaixo.
            </p>
            {form.phases.map((p, i) =>
              p.template ? (
                <label key={i} className="toggle">
                  <input
                    type="checkbox"
                    checked={p.included}
                    onChange={(e) => setPhase(i, { included: e.target.checked })}
                  />
                  <span>
                    <strong>{p.name}</strong>
                    <span className="muted"> {PROPERTY_PART_TEXT[p.template]}</span>
                  </span>
                </label>
              ) : null,
            )}
          </section>
        )}

        {(isProperty || form.advanced) && (
          <section className="stack" aria-label="Fases">
            {!isProperty && <h2>{form.phases.length > 1 ? 'Fases' : 'Parcelas'}</h2>}
            {form.phases.map((p, i) =>
              !p.included ? null : (
                <PhaseEditor
                  key={i}
                  p={p}
                  i={i}
                  isProperty={isProperty}
                  canRemove={!p.template && form.phases.length > 1}
                  onChange={(next) => setPhase(i, next)}
                  onRemove={() =>
                    set(
                      'phases',
                      form.phases.filter((_, k) => k !== i),
                    )
                  }
                />
              ),
            )}
            {!useSimple && pastRows > 0 && (
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={form.pastAllPaid}
                  onChange={(e) => set('pastAllPaid', e.target.checked)}
                />
                <span>
                  <strong>
                    Já paguei as {pastRows} parcela{pastRows > 1 ? 's' : ''} que venceram antes de
                    hoje
                  </strong>
                  <span className="muted">
                    {' '}
                    Desmarque se alguma ficou em aberto: elas aparecem como atrasadas.
                  </span>
                </span>
              </label>
            )}
            {form.phases.length < 8 && (
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() =>
                  set('phases', [
                    ...form.phases,
                    phase({ name: `Fase ${form.phases.filter((p) => p.included).length + 1}` }),
                  ])
                }
              >
                <Plus size={16} aria-hidden="true" />
                {isProperty ? 'Outra parte do contrato' : 'Adicionar fase'}
              </button>
            )}
          </section>
        )}

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
