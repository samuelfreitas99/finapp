import { addDays, compareDates } from '@finapp/core';
import type { Account, Category } from '@finapp/shared';
import { ChevronDown, ChevronUp, Zap } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { MoneyInput } from '../../components/MoneyInput';
import { ApiError } from '../../lib/api';
import { categoryIcon } from '../../lib/category-icons';
import { sortByUsage } from '../../lib/category-usage';
import { today } from '../../lib/dates';
import { formatDate } from '../../lib/format';

export type EntryKind = 'expense' | 'income' | 'transfer';

export interface EntryState {
  kind: EntryKind;
  amount: number;
  categoryId: string | null;
  description: string;
  accountId: string;
  toAccountId: string;
  date: string;
  /** Já pago/recebido (efetivado). Data futura sempre vira previsto. */
  done: boolean;
  pix: boolean;
  pixCounterparty: string;
  notes: string;
}

const KIND_LABEL: Record<EntryKind, string> = {
  expense: 'Despesa',
  income: 'Receita',
  transfer: 'Transferência',
};

const DONE_LABEL: Record<EntryKind, string> = {
  expense: 'Já paguei',
  income: 'Já recebi',
  transfer: 'Já transferi',
};

const VISIBLE_CATEGORIES = 7;

export function isFuture(date: string) {
  return compareDates(date, today()) > 0;
}

export function errorText(err: unknown) {
  return err instanceof ApiError ? err.message : 'Algo deu errado. Tente de novo.';
}

/**
 * Formulário do "+" (e da edição): tipo, valor grande, categoria em grade, conta,
 * data com atalhos. `lockKind` impede trocar o tipo (edição).
 */
export function EntryForm({
  initial,
  accounts,
  categories,
  lockKind = false,
  transferAccountsLocked = false,
  pending,
  error,
  submitLabel,
  onSubmit,
}: {
  initial: EntryState;
  accounts: Account[];
  categories: Category[];
  lockKind?: boolean;
  transferAccountsLocked?: boolean;
  pending: boolean;
  error: unknown;
  submitLabel?: string;
  onSubmit: (state: EntryState) => void;
}) {
  const [form, setForm] = useState(initial);
  const [allCategories, setAllCategories] = useState(false);
  const [otherDate, setOtherDate] = useState(
    initial.date !== today() && initial.date !== addDays(today(), -1),
  );
  const set = <K extends keyof EntryState>(key: K, value: EntryState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const [ordered] = useState(() => sortByUsage(categories));
  const kindCategories = ordered.filter(
    (c) => !c.isSystem && !c.archived && c.kind === (form.kind === 'income' ? 'income' : 'expense'),
  );
  const selectedIndex = kindCategories.findIndex((c) => c.id === form.categoryId);
  const shownCategories =
    allCategories || selectedIndex >= VISIBLE_CATEGORIES
      ? kindCategories
      : kindCategories.slice(0, VISIBLE_CATEGORIES);
  const future = isFuture(form.date);
  const isTransfer = form.kind === 'transfer';
  const sameAccounts = isTransfer && form.accountId === form.toAccountId;
  const ready =
    form.amount > 0 && form.accountId && (!isTransfer || (form.toAccountId && !sameAccounts));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    onSubmit({ ...form, done: form.done && !future });
  };

  const accountOptions = accounts.map((a) => (
    <option key={a.id} value={a.id}>
      {a.name}
    </option>
  ));

  return (
    <form className="entry" onSubmit={submit} noValidate>
      {!lockKind && (
        <div className="segmented" role="group" aria-label="Tipo de lançamento">
          {(['expense', 'income', 'transfer'] as const).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={form.kind === k}
              className={`segmented--${k}`}
              onClick={() => setForm((f) => ({ ...f, kind: k, categoryId: null }))}
            >
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>
      )}

      <div className="entry__amount">
        <label htmlFor="amount" className="muted">
          Valor
        </label>
        <MoneyInput
          id="amount"
          value={form.amount}
          onChange={(v) => set('amount', v)}
          large
          autoFocus
        />
      </div>

      {error ? (
        <p className="alert alert--error" role="alert">
          {errorText(error)}
        </p>
      ) : null}

      {!isTransfer && (
        <div className="entry__quick">
          <button
            type="button"
            className="chip"
            aria-pressed={form.pix}
            onClick={() => set('pix', !form.pix)}
          >
            <Zap size={16} aria-hidden="true" />
            Pix
          </button>
        </div>
      )}

      {!isTransfer && form.pix && (
        <div className="field">
          <label htmlFor="pixCounterparty">
            {form.kind === 'expense' ? 'Pix para quem' : 'Pix de quem'}
          </label>
          <input
            id="pixCounterparty"
            className="input"
            maxLength={120}
            placeholder="Nome ou chave"
            value={form.pixCounterparty}
            onChange={(e) => set('pixCounterparty', e.target.value)}
          />
        </div>
      )}

      {!isTransfer && (
        <fieldset className="fieldset">
          <legend className="field-label">Categoria</legend>
          <div className="category-grid">
            {shownCategories.map((c) => {
              const Icon = categoryIcon(c.icon);
              return (
                <button
                  key={c.id}
                  type="button"
                  className="category"
                  aria-pressed={form.categoryId === c.id}
                  onClick={() => set('categoryId', form.categoryId === c.id ? null : c.id)}
                >
                  <span
                    className="category__icon"
                    style={{ background: c.color ?? 'var(--muted)' }}
                  >
                    <Icon size={16} aria-hidden="true" />
                  </span>
                  <span className="category__name">{c.name}</span>
                </button>
              );
            })}
            {kindCategories.length > VISIBLE_CATEGORIES && selectedIndex < VISIBLE_CATEGORIES && (
              <button
                type="button"
                className="category"
                aria-expanded={allCategories}
                onClick={() => setAllCategories((v) => !v)}
              >
                <span className="category__icon category__icon--more">
                  {allCategories ? (
                    <ChevronUp size={16} aria-hidden="true" />
                  ) : (
                    <ChevronDown size={16} aria-hidden="true" />
                  )}
                </span>
                <span className="category__name">{allCategories ? 'Menos' : 'Mais'}</span>
              </button>
            )}
          </div>
        </fieldset>
      )}

      <div className="card entry__details">
        <div className="entry__row">
          <label htmlFor="description">Descrição</label>
          <input
            id="description"
            className="entry__input"
            maxLength={120}
            placeholder={
              kindCategories.find((c) => c.id === form.categoryId)?.name ?? KIND_LABEL[form.kind]
            }
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
          />
        </div>
        <div className="entry__row">
          <label htmlFor="account">{isTransfer ? 'De' : 'Conta'}</label>
          <select
            id="account"
            className="entry__input"
            value={form.accountId}
            disabled={transferAccountsLocked}
            onChange={(e) => set('accountId', e.target.value)}
          >
            {accountOptions}
          </select>
        </div>
        {isTransfer && (
          <div className="entry__row">
            <label htmlFor="toAccount">Para</label>
            <select
              id="toAccount"
              className="entry__input"
              value={form.toAccountId}
              disabled={transferAccountsLocked}
              aria-invalid={sameAccounts}
              onChange={(e) => set('toAccountId', e.target.value)}
            >
              <option value="">Escolha a conta</option>
              {accountOptions}
            </select>
          </div>
        )}
        <div className="entry__row entry__row--date">
          <span className="entry__label" id="date-label">
            Data
          </span>
          <div className="entry__dates" role="group" aria-labelledby="date-label">
            <button
              type="button"
              className="chip"
              aria-pressed={!otherDate && form.date === today()}
              onClick={() => {
                setOtherDate(false);
                set('date', today());
              }}
            >
              Hoje
            </button>
            <button
              type="button"
              className="chip"
              aria-pressed={!otherDate && form.date === addDays(today(), -1)}
              onClick={() => {
                setOtherDate(false);
                set('date', addDays(today(), -1));
              }}
            >
              Ontem
            </button>
            <button
              type="button"
              className="chip"
              aria-pressed={otherDate}
              onClick={() => setOtherDate(true)}
            >
              Outra
            </button>
          </div>
        </div>
        {otherDate && (
          <div className="entry__row">
            <label htmlFor="date">Dia</label>
            <input
              id="date"
              type="date"
              className="entry__input"
              value={form.date}
              onChange={(e) => e.target.value && set('date', e.target.value)}
            />
          </div>
        )}
      </div>

      {sameAccounts && (
        <p className="field-error" role="alert">
          Escolha contas diferentes para a transferência.
        </p>
      )}

      {future ? (
        <p className="alert">
          {formatDate(form.date)} ainda não chegou: fica como <strong>previsto</strong> e entra no
          saldo previsto. Confirme quando acontecer.
        </p>
      ) : (
        <label className="toggle">
          <input
            type="checkbox"
            checked={form.done}
            onChange={(e) => set('done', e.target.checked)}
          />
          <span>
            <strong>{DONE_LABEL[form.kind]}</strong>
            <span className="muted">Desmarque para deixar como previsto.</span>
          </span>
        </label>
      )}

      <details className="entry__more">
        <summary>Observações</summary>
        <textarea
          className="input"
          maxLength={2000}
          aria-label="Observações"
          value={form.notes}
          onChange={(e) => set('notes', e.target.value)}
        />
      </details>

      <button
        type="submit"
        className={`btn btn--primary btn--block entry__save entry__save--${form.kind}`}
        disabled={pending || !ready}
      >
        {pending ? 'Salvando…' : (submitLabel ?? `Salvar ${KIND_LABEL[form.kind].toLowerCase()}`)}
      </button>
    </form>
  );
}
