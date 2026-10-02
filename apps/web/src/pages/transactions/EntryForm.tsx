import { addDays, addMonths, compareDates } from '@finapp/core';
import type { Account, Card, Category } from '@finapp/shared';
import { ChevronDown, ChevronUp, Layers, Zap } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { MoneyInput } from '../../components/MoneyInput';
import { ApiError } from '../../lib/api';
import { categoryIcon } from '../../lib/category-icons';
import { sortByUsage } from '../../lib/category-usage';
import { monthLabel, today } from '../../lib/dates';
import { formatBRL, formatDate } from '../../lib/format';
import { useInstallmentPreview } from '../../lib/queries';

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
  /** 1 = à vista; 2+ = parcelado (no cartão ou em carnê/boleto na conta). */
  installments: number;
  /** Carnê/boleto: vencimento da 1ª parcela (vazio = um mês depois da compra). */
  firstDueDate: string;
  /** Carnê/boleto: vencimento em fim de semana/feriado. */
  adjust: 'none' | 'previous' | 'next';
}

export const CARD_PREFIX = 'card:';
export const isCardTarget = (value: string) => value.startsWith(CARD_PREFIX);

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
  cards = [],
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
  cards?: Card[];
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
  const onCard = !isTransfer && isCardTarget(form.accountId);
  const cardId = onCard ? form.accountId.slice(CARD_PREFIX.length) : null;
  const splitting = !isTransfer && form.kind === 'expense' && form.installments > 1;
  const firstDueDate = form.firstDueDate || addMonths(form.date, 1);
  const preview = useInstallmentPreview(
    splitting && form.amount > 0 && form.accountId
      ? {
          description: 'prévia',
          ...(cardId
            ? { cardId }
            : { accountId: form.accountId, firstDueDate, adjust: form.adjust }),
          totalAmount: form.amount,
          installments: form.installments,
          firstDate: form.date,
        }
      : null,
  );
  const previewItems = preview.data?.items ?? [];
  const sameAccounts = isTransfer && form.accountId === form.toAccountId;
  const ready =
    form.amount > 0 && form.accountId && (!isTransfer || (form.toAccountId && !sameAccounts));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    onSubmit({
      ...form,
      firstDueDate,
      done: onCard ? !future : form.done && !future,
    });
  };

  const accountOptions = accounts.map((a) => (
    <option key={a.id} value={a.id}>
      {a.name}
    </option>
  ));
  const targetOptions =
    cards.length > 0 && !isTransfer ? (
      <>
        <optgroup label="Contas">{accountOptions}</optgroup>
        <optgroup label="Cartões">
          {cards.map((c) => (
            <option key={c.id} value={`${CARD_PREFIX}${c.id}`}>
              {c.name}
            </option>
          ))}
        </optgroup>
      </>
    ) : (
      accountOptions
    );

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
          {!onCard && !splitting && (
            <button
              type="button"
              className="chip"
              aria-pressed={form.pix}
              onClick={() => set('pix', !form.pix)}
            >
              <Zap size={16} aria-hidden="true" />
              Pix
            </button>
          )}
          {form.kind === 'expense' && !lockKind && (
            <button
              type="button"
              className="chip"
              aria-pressed={form.installments > 1}
              onClick={() =>
                setForm((f) => ({ ...f, installments: f.installments > 1 ? 1 : 2, pix: false }))
              }
            >
              <Layers size={16} aria-hidden="true" />
              Parcelar
            </button>
          )}
        </div>
      )}

      {splitting && (
        <div className="split card card--pad">
          <div className="field">
            <label htmlFor="installments">Parcelas</label>
            <select
              id="installments"
              className="input"
              value={form.installments}
              onChange={(e) => set('installments', Number(e.target.value))}
            >
              {Array.from({ length: 23 }, (_, i) => i + 2).map((n) => (
                <option key={n} value={n}>
                  {n}x {form.amount > 0 ? `de ${formatBRL(Math.floor(form.amount / n))}` : ''}
                </option>
              ))}
            </select>
          </div>
          {!onCard && (
            <>
              <div className="field">
                <label htmlFor="firstDueDate">Vencimento da 1ª parcela</label>
                <input
                  id="firstDueDate"
                  type="date"
                  className="input"
                  value={firstDueDate}
                  onChange={(e) => e.target.value && set('firstDueDate', e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="adjust">Se vencer em fim de semana ou feriado</label>
                <select
                  id="adjust"
                  className="input"
                  value={form.adjust}
                  onChange={(e) => set('adjust', e.target.value as EntryState['adjust'])}
                >
                  <option value="none">Manter a data</option>
                  <option value="next">Passar para o próximo dia útil</option>
                  <option value="previous">Antecipar para o dia útil anterior</option>
                </select>
              </div>
            </>
          )}
          {previewItems.length > 0 && (
            <p className="split__preview" aria-live="polite">
              <strong>
                {previewItems.length}x de {formatBRL(previewItems.at(-1)?.amount ?? 0)}
                {previewItems[0] && previewItems[0].amount !== previewItems.at(-1)?.amount
                  ? ` (1ª de ${formatBRL(previewItems[0].amount)})`
                  : ''}
              </strong>
              {onCard ? (
                <span>
                  1ª na fatura de {monthLabel(previewItems[0]?.invoiceMonth ?? '')}, última em{' '}
                  {monthLabel(previewItems.at(-1)?.invoiceMonth ?? '')}.
                </span>
              ) : (
                <span>
                  1ª vence em {formatDate(previewItems[0]?.date ?? firstDueDate)}, última em{' '}
                  {formatDate(previewItems.at(-1)?.date ?? firstDueDate)}. Cada parcela fica
                  prevista na conta até você confirmar o pagamento.
                </span>
              )}
            </p>
          )}
        </div>
      )}

      {!isTransfer && !onCard && form.pix && (
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
          <label htmlFor="account">{isTransfer ? 'De' : 'Onde'}</label>
          <select
            id="account"
            className="entry__input"
            value={form.accountId}
            disabled={transferAccountsLocked}
            onChange={(e) => {
              const value = e.target.value;
              setForm((f) => ({
                ...f,
                accountId: value,
                ...(isCardTarget(value) ? { pix: false } : { installments: 1 }),
              }));
            }}
          >
            {targetOptions}
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

      {splitting ? null : onCard ? (
        future ? (
          <p className="alert">
            Compra com data futura fica como <strong>prevista</strong> na fatura.
          </p>
        ) : null
      ) : future ? (
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
        {pending
          ? 'Salvando…'
          : (submitLabel ??
            (splitting
              ? `Parcelar em ${form.installments}x`
              : onCard
                ? form.kind === 'income'
                  ? 'Salvar estorno'
                  : 'Salvar compra'
                : `Salvar ${KIND_LABEL[form.kind].toLowerCase()}`))}
      </button>
    </form>
  );
}
