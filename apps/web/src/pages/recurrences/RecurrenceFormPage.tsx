import { todayIn } from '@finapp/core';
import type {
  DayRuleBody,
  Recurrence,
  RecurrenceBody,
  RecurrenceFrequency,
  UpdateRecurrenceBody,
} from '@finapp/shared';
import { Plus, Trash2, X } from 'lucide-react';
import { useDeferredValue, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { MoneyInput } from '../../components/MoneyInput';
import { PageHeader } from '../../components/PageHeader';
import { useToast } from '../../components/Toast';
import { currentMonth, monthLabel } from '../../lib/dates';
import { formatDate, money } from '../../lib/format';
import {
  useAccounts,
  useCards,
  useCategories,
  useRecurrence,
  useRecurrenceMutations,
  useRecurrencePreview,
} from '../../lib/queries';
import { CARD_PREFIX, errorText, isCardTarget } from '../transactions/EntryForm';

type RuleKind = DayRuleBody['kind'];
type Adjust = 'none' | 'previous' | 'next';

interface RuleState {
  kind: RuleKind;
  day: number;
  n: number;
  adjust: Adjust;
}

interface PartState extends RuleState {
  label: string;
  percent: string;
  monthOffset: number;
}

interface FormState {
  type: 'income' | 'expense';
  description: string;
  amount: number;
  frequency: RecurrenceFrequency;
  interval: number;
  rule: RuleState;
  split: boolean;
  parts: PartState[];
  startDate: string;
  endDate: string;
  target: string;
  categoryId: string | null;
  variableAmount: boolean;
}

const FREQUENCIES: { value: RecurrenceFrequency; label: string }[] = [
  { value: 'monthly', label: 'Todo mês' },
  { value: 'weekly', label: 'Toda semana' },
  { value: 'yearly', label: 'Todo ano' },
  { value: 'every_n_months', label: 'A cada N meses' },
];

const SALARY_PARTS: PartState[] = [
  {
    label: 'Adiantamento',
    percent: '40',
    kind: 'fixed_day',
    day: 15,
    n: 5,
    adjust: 'previous',
    monthOffset: 0,
  },
  {
    label: 'Salário',
    percent: '60',
    kind: 'nth_business_day',
    day: 5,
    n: 5,
    adjust: 'none',
    monthOffset: 1,
  },
];

function toDayRule(r: RuleState): DayRuleBody {
  if (r.kind === 'fixed_day') return { kind: 'fixed_day', day: r.day };
  if (r.kind === 'nth_business_day') return { kind: 'nth_business_day', n: r.n };
  return { kind: 'last_business_day' };
}

function fromDayRule(rule: DayRuleBody | null | undefined, adjust: Adjust = 'none'): RuleState {
  if (rule?.kind === 'nth_business_day') return { kind: rule.kind, day: 10, n: rule.n, adjust };
  if (rule?.kind === 'last_business_day') return { kind: rule.kind, day: 10, n: 5, adjust };
  return { kind: 'fixed_day', day: rule?.kind === 'fixed_day' ? rule.day : 10, n: 5, adjust };
}

const percentValue = (p: string) => Number(p.replace(',', '.'));

function toBody(f: FormState): RecurrenceBody {
  const cardId = isCardTarget(f.target) ? f.target.slice(CARD_PREFIX.length) : undefined;
  const splitting = f.split && f.frequency !== 'weekly';
  return {
    type: f.type,
    description: f.description.trim() || (f.type === 'income' ? 'Receita fixa' : 'Despesa fixa'),
    amount: f.amount,
    frequency: f.frequency,
    interval: f.frequency === 'every_n_months' || f.frequency === 'weekly' ? f.interval : 1,
    dayRule: splitting || f.frequency === 'weekly' ? null : toDayRule(f.rule),
    adjust: f.rule.kind === 'fixed_day' ? f.rule.adjust : 'none',
    parts: splitting
      ? f.parts.map((p) => ({
          ...(p.label.trim() ? { label: p.label.trim() } : {}),
          percent: percentValue(p.percent),
          dayRule: toDayRule(p),
          adjust: p.kind === 'fixed_day' ? p.adjust : 'none',
          monthOffset: p.monthOffset,
        }))
      : null,
    startDate: f.startDate,
    endDate: f.endDate || null,
    ...(cardId ? { cardId } : { accountId: f.target }),
    categoryId: f.categoryId,
    variableAmount: f.type === 'expense' && f.variableAmount,
  };
}

function RuleFields({
  id,
  rule,
  onChange,
}: {
  id: string;
  rule: RuleState;
  onChange: (r: RuleState) => void;
}) {
  return (
    <div className="rule-fields">
      <div className="field">
        <label htmlFor={`${id}-kind`}>Dia</label>
        <select
          id={`${id}-kind`}
          className="input"
          value={rule.kind}
          onChange={(e) => onChange({ ...rule, kind: e.target.value as RuleKind })}
        >
          <option value="fixed_day">Dia fixo do mês</option>
          <option value="nth_business_day">N-ésimo dia útil</option>
          <option value="last_business_day">Último dia útil</option>
        </select>
      </div>
      {rule.kind === 'fixed_day' && (
        <>
          <div className="field">
            <label htmlFor={`${id}-day`}>Dia do mês</label>
            <select
              id={`${id}-day`}
              className="input"
              value={rule.day}
              onChange={(e) => onChange({ ...rule, day: Number(e.target.value) })}
            >
              {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor={`${id}-adjust`}>Fim de semana ou feriado</label>
            <select
              id={`${id}-adjust`}
              className="input"
              value={rule.adjust}
              onChange={(e) => onChange({ ...rule, adjust: e.target.value as Adjust })}
            >
              <option value="none">Manter a data</option>
              <option value="previous">Antecipar</option>
              <option value="next">Adiar</option>
            </select>
          </div>
        </>
      )}
      {rule.kind === 'nth_business_day' && (
        <div className="field">
          <label htmlFor={`${id}-n`}>Qual dia útil</label>
          <select
            id={`${id}-n`}
            className="input"
            value={rule.n}
            onChange={(e) => onChange({ ...rule, n: Number(e.target.value) })}
          >
            {Array.from({ length: 23 }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n}º
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}

function RecurrenceForm({
  initial,
  editing,
  pending,
  error,
  onSubmit,
}: {
  initial: FormState;
  editing: boolean;
  pending: boolean;
  error: unknown;
  onSubmit: (f: FormState) => void;
}) {
  const accounts = useAccounts();
  const cards = useCards();
  const categories = useCategories();
  const [form, setForm] = useState(initial);
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));
  const setPart = (i: number, part: Partial<PartState>) =>
    setForm((f) => ({ ...f, parts: f.parts.map((p, k) => (k === i ? { ...p, ...part } : p)) }));

  const canSplit = form.frequency !== 'weekly';
  const percentSum = form.parts.reduce((s, p) => s + percentValue(p.percent), 0);
  const splitOk = !form.split || !canSplit || Math.abs(percentSum - 100) < 0.001;
  const ready = form.amount > 0 && Boolean(form.target) && splitOk;
  const deferred = useDeferredValue(form);
  const preview = useRecurrencePreview(ready ? toBody(deferred) : null);
  const cats = (categories.data ?? []).filter(
    (c) => !c.isSystem && !c.archived && c.kind === form.type,
  );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (ready) onSubmit(form);
  };

  return (
    <form className="form card card--pad" onSubmit={submit} noValidate>
      {Boolean(error) && (
        <p className="alert alert--error" role="alert">
          {errorText(error)}
        </p>
      )}
      {!editing && (
        <div className="segmented" role="group" aria-label="Tipo">
          {(['income', 'expense'] as const).map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={form.type === t}
              className={`segmented--${t}`}
              onClick={() =>
                setForm((f) => ({
                  ...f,
                  type: t,
                  categoryId: null,
                  ...(t === 'income' && isCardTarget(f.target)
                    ? { target: accounts.data?.[0]?.id ?? '' }
                    : {}),
                }))
              }
            >
              {t === 'income' ? 'Receita' : 'Despesa'}
            </button>
          ))}
        </div>
      )}
      <div className="field">
        <label htmlFor="description">Descrição</label>
        <input
          id="description"
          className="input"
          maxLength={120}
          placeholder={form.type === 'income' ? 'Ex.: Salário' : 'Ex.: Aluguel, Internet'}
          value={form.description}
          onChange={(e) => set('description', e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="amount">{form.split && canSplit ? 'Valor total' : 'Valor'}</label>
        <MoneyInput
          id="amount"
          value={form.amount}
          onChange={(v) => set('amount', Math.max(0, v))}
        />
      </div>
      {form.type === 'expense' && (
        <label className="toggle">
          <input
            type="checkbox"
            checked={form.variableAmount}
            onChange={(e) => set('variableAmount', e.target.checked)}
          />
          <span>
            <strong>Valor muda todo mês</strong>
            <span className="muted">
              Luz, água: o valor acima é a estimativa; ao pagar, você informa o real.
            </span>
          </span>
        </label>
      )}
      <div className="field-row">
        <div className="field">
          <label htmlFor="frequency">Repete</label>
          <select
            id="frequency"
            className="input"
            value={form.frequency}
            onChange={(e) => set('frequency', e.target.value as RecurrenceFrequency)}
          >
            {FREQUENCIES.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </div>
        {(form.frequency === 'every_n_months' || form.frequency === 'weekly') && (
          <div className="field">
            <label htmlFor="interval">
              {form.frequency === 'weekly' ? 'A cada quantas semanas' : 'A cada quantos meses'}
            </label>
            <input
              id="interval"
              className="input num"
              type="number"
              min={1}
              max={120}
              value={form.interval}
              onChange={(e) => set('interval', Math.max(1, Number(e.target.value) || 1))}
            />
          </div>
        )}
      </div>

      {form.type === 'income' && canSplit && (
        <label className="toggle">
          <input
            type="checkbox"
            checked={form.split}
            onChange={(e) => set('split', e.target.checked)}
          />
          <span>
            <strong>Recebo em partes</strong>
            <span className="muted">
              Ex.: adiantamento no dia 15 e o restante no 5º dia útil do mês seguinte.
            </span>
          </span>
        </label>
      )}

      {form.split && canSplit ? (
        <div className="parts">
          {form.parts.map((p, i) => (
            <fieldset key={i} className="part card card--pad">
              <legend className="sr-only">Parte {i + 1}</legend>
              <div className="field-row">
                <div className="field">
                  <label htmlFor={`part-${i}-label`}>Nome</label>
                  <input
                    id={`part-${i}-label`}
                    className="input"
                    maxLength={60}
                    value={p.label}
                    onChange={(e) => setPart(i, { label: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label htmlFor={`part-${i}-percent`}>% do total</label>
                  <input
                    id={`part-${i}-percent`}
                    className="input num"
                    inputMode="decimal"
                    value={p.percent}
                    onChange={(e) => setPart(i, { percent: e.target.value })}
                  />
                </div>
              </div>
              <RuleFields id={`part-${i}`} rule={p} onChange={(r) => setPart(i, r)} />
              <div className="field">
                <label htmlFor={`part-${i}-offset`}>Mês</label>
                <select
                  id={`part-${i}-offset`}
                  className="input"
                  value={p.monthOffset}
                  onChange={(e) => setPart(i, { monthOffset: Number(e.target.value) })}
                >
                  <option value={0}>No próprio mês</option>
                  <option value={1}>No mês seguinte</option>
                </select>
              </div>
              {form.parts.length > 2 && (
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() =>
                    set(
                      'parts',
                      form.parts.filter((_, k) => k !== i),
                    )
                  }
                >
                  <X size={16} aria-hidden="true" />
                  Remover parte
                </button>
              )}
            </fieldset>
          ))}
          <div className="parts__footer">
            <span className={splitOk ? 'muted' : 'field-error'}>
              Soma: {percentSum.toLocaleString('pt-BR')}% {splitOk ? '' : '(precisa dar 100%)'}
            </span>
            {form.parts.length < 6 && (
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() =>
                  set('parts', [
                    ...form.parts,
                    {
                      label: '',
                      percent: '0',
                      kind: 'fixed_day',
                      day: 1,
                      n: 5,
                      adjust: 'none',
                      monthOffset: 0,
                    },
                  ])
                }
              >
                <Plus size={16} aria-hidden="true" />
                Parte
              </button>
            )}
          </div>
        </div>
      ) : (
        form.frequency !== 'weekly' && (
          <RuleFields id="rule" rule={form.rule} onChange={(r) => set('rule', r)} />
        )
      )}

      <div className="field-row">
        <div className="field">
          <label htmlFor="startDate">
            {form.frequency === 'weekly' ? 'Primeira vez' : 'Começa em'}
          </label>
          <input
            id="startDate"
            type="date"
            className="input"
            disabled={editing}
            value={form.startDate}
            onChange={(e) => e.target.value && set('startDate', e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="endDate">Termina em (opcional)</label>
          <input
            id="endDate"
            type="date"
            className="input"
            min={form.startDate}
            value={form.endDate}
            onChange={(e) => set('endDate', e.target.value)}
          />
        </div>
      </div>

      <div className="field">
        <label htmlFor="target">{form.type === 'income' ? 'Entra na conta' : 'Sai de'}</label>
        <select
          id="target"
          className="input"
          value={form.target}
          disabled={editing}
          onChange={(e) => set('target', e.target.value)}
        >
          <optgroup label="Contas">
            {(accounts.data ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </optgroup>
          {form.type === 'expense' && (cards.data ?? []).length > 0 && (
            <optgroup label="Cartões">
              {(cards.data ?? []).map((c) => (
                <option key={c.id} value={`${CARD_PREFIX}${c.id}`}>
                  {c.name}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </div>

      <div className="field">
        <label htmlFor="category">Categoria</label>
        <select
          id="category"
          className="input"
          value={form.categoryId ?? ''}
          onChange={(e) => set('categoryId', e.target.value || null)}
        >
          <option value="">Sem categoria</option>
          {cats.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {ready && (
        <section className="preview" aria-live="polite" aria-label="Próximas ocorrências">
          <h3>Próximas ocorrências</h3>
          {preview.isError ? (
            <p className="field-error">{errorText(preview.error)}</p>
          ) : (
            <ul className="preview__list">
              {(preview.data ?? []).slice(0, 6).map((o) => (
                <li key={`${o.date}-${o.label ?? ''}`}>
                  <span>
                    {formatDate(o.date)}
                    {o.label ? ` (${o.label})` : ''}
                  </span>
                  <strong className="num">{money(o.amount)}</strong>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <button type="submit" className="btn btn--primary btn--block" disabled={pending || !ready}>
        {pending ? 'Salvando…' : editing ? 'Salvar' : 'Criar'}
      </button>
    </form>
  );
}

export function NewRecurrencePage() {
  const accounts = useAccounts();
  const { create } = useRecurrenceMutations();
  const navigate = useNavigate();
  const toast = useToast();
  if (accounts.isPending) return <div className="skeleton" style={{ height: 480 }} />;
  return (
    <>
      <PageHeader title="Nova recorrência" back="/fixas" />
      <RecurrenceForm
        initial={{
          type: 'expense',
          description: '',
          amount: 0,
          frequency: 'monthly',
          interval: 1,
          rule: { kind: 'fixed_day', day: Number(todayIn().slice(8, 10)), n: 5, adjust: 'none' },
          split: false,
          parts: SALARY_PARTS,
          startDate: todayIn(),
          endDate: '',
          target: accounts.data?.[0]?.id ?? '',
          categoryId: null,
          variableAmount: false,
        }}
        editing={false}
        pending={create.isPending}
        error={create.error}
        onSubmit={(f) =>
          create.mutate(toBody(f), {
            onSuccess: () => {
              toast({ text: 'Recorrência criada. Os próximos 12 meses já estão previstos.' });
              navigate('/fixas');
            },
          })
        }
      />
    </>
  );
}

function toState(r: Recurrence): FormState {
  return {
    type: r.type,
    description: r.description,
    amount: r.amount,
    frequency: r.frequency,
    interval: r.interval,
    rule: fromDayRule(r.dayRule, r.adjust),
    split: Boolean(r.parts?.length),
    parts: r.parts?.length
      ? r.parts.map((p) => ({
          ...fromDayRule(p.dayRule, p.adjust ?? 'none'),
          label: p.label ?? '',
          percent: String(p.percent ?? 0).replace('.', ','),
          monthOffset: p.monthOffset ?? 0,
        }))
      : SALARY_PARTS,
    startDate: r.startDate,
    endDate: r.endDate ?? '',
    target: r.cardId ? `${CARD_PREFIX}${r.cardId}` : (r.accountId ?? ''),
    categoryId: r.categoryId,
    variableAmount: r.variableAmount,
  };
}

/** Só os campos que mudaram (o servidor trata valor/regra como "a partir de"). */
function diff(before: FormState, after: FormState): UpdateRecurrenceBody {
  const a = toBody(before);
  const b = toBody(after);
  const out: UpdateRecurrenceBody = {};
  const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);
  if (a.description !== b.description) out.description = b.description;
  if (!same(a.categoryId ?? null, b.categoryId ?? null)) out.categoryId = b.categoryId ?? null;
  if (a.amount !== b.amount) out.amount = b.amount;
  if (a.frequency !== b.frequency) out.frequency = b.frequency;
  if (a.interval !== b.interval) out.interval = b.interval ?? 1;
  if (!same(a.dayRule ?? null, b.dayRule ?? null)) out.dayRule = b.dayRule ?? null;
  if (a.adjust !== b.adjust) out.adjust = b.adjust ?? 'none';
  if (!same(a.parts ?? null, b.parts ?? null)) out.parts = b.parts ?? null;
  if ((a.endDate ?? null) !== (b.endDate ?? null)) out.endDate = b.endDate ?? null;
  if (a.variableAmount !== b.variableAmount) out.variableAmount = b.variableAmount ?? false;
  return out;
}

const SCHEDULE: (keyof UpdateRecurrenceBody)[] = [
  'amount',
  'frequency',
  'interval',
  'dayRule',
  'adjust',
  'parts',
];

export function EditRecurrencePage() {
  const { id = '' } = useParams();
  const rec = useRecurrence(id);
  const { update, end } = useRecurrenceMutations();
  const navigate = useNavigate();
  const toast = useToast();
  const [from, setFrom] = useState(currentMonth());

  if (rec.isPending) return <div className="skeleton" style={{ height: 480 }} />;
  if (rec.isError || !rec.data) {
    return (
      <>
        <PageHeader title="Recorrência" back="/fixas" />
        <p className="alert alert--error" role="alert">
          {errorText(rec.error)}
        </p>
      </>
    );
  }
  const r = rec.data;
  const initial = toState(r);
  const months = Array.from({ length: 13 }, (_, i) => {
    const [y, m] = currentMonth().split('-').map(Number) as [number, number];
    const idx = y * 12 + (m - 1) + i;
    return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
  });

  return (
    <>
      <PageHeader title={r.description} back="/fixas" />
      <section className="card card--pad form" aria-label="A partir de quando">
        <div className="field">
          <label htmlFor="from">Mudança de valor ou de dia vale a partir de</label>
          <select
            id="from"
            className="input"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          >
            {months.map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
              </option>
            ))}
          </select>
          <span className="muted field-hint">
            Os lançamentos já confirmados e os que você editou à mão não mudam.
          </span>
        </div>
      </section>
      <RecurrenceForm
        key={r.id}
        initial={initial}
        editing
        pending={update.isPending}
        error={update.error}
        onSubmit={(f) => {
          const body = diff(initial, f);
          if (!Object.keys(body).length) {
            navigate('/fixas');
            return;
          }
          const schedule = SCHEDULE.some((k) => body[k] !== undefined);
          update.mutate(
            { id: r.id, ...(schedule ? { from } : {}), body },
            {
              onSuccess: () => {
                toast({
                  text: schedule
                    ? `Alterado a partir de ${monthLabel(from)}.`
                    : 'Recorrência salva.',
                });
                navigate('/fixas');
              },
            },
          );
        }}
      />
      <section className="card card--pad form" aria-label="Encerrar">
        <button
          type="button"
          className="btn btn--danger"
          disabled={end.isPending}
          onClick={() => {
            if (
              !window.confirm(`Encerrar "${r.description}"? Os previstos futuros serão apagados.`)
            )
              return;
            end.mutate(r.id, {
              onSuccess: () => {
                toast({ text: 'Recorrência encerrada.' });
                navigate('/fixas');
              },
            });
          }}
        >
          <Trash2 size={18} aria-hidden="true" />
          Encerrar recorrência
        </button>
      </section>
    </>
  );
}
