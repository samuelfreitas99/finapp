import { addYearMonths } from '@finapp/core';
import type { BudgetItem } from '@finapp/shared';
import { ChevronLeft, ChevronRight, PiggyBank, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { MoneyInput } from '../../components/MoneyInput';
import { PageHeader } from '../../components/PageHeader';
import { useToast } from '../../components/Toast';
import { currentMonth, monthLabel } from '../../lib/dates';
import { money } from '../../lib/format';
import { useHiddenValues } from '../../lib/hidden-values';
import { useBudgetMutations, useBudgets, useCategories } from '../../lib/queries';
import { errorText } from '../transactions/EntryForm';

const LEVEL_TEXT = { ok: '', warning: 'Perto do limite', exceeded: 'Estourou' } as const;

function BudgetRow({ item, onEdit }: { item: BudgetItem; onEdit: () => void }) {
  const { hidden } = useHiddenValues();
  const pct = Math.min(100, Math.round(item.ratio * 100));
  return (
    <li className="budget-row">
      <button type="button" className="row-link budget-row__btn" onClick={onEdit}>
        <span className="row-link__main">
          <strong>{item.categoryName}</strong>
          <span
            className="progress"
            role="progressbar"
            aria-label={`${item.categoryName}: ${Math.round(item.ratio * 100)}% do orçamento usado`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
          >
            <span className={`budget-bar budget-bar--${item.level}`} style={{ width: `${pct}%` }} />
          </span>
          <span className="muted">
            {money(item.spent, hidden)} de {money(item.available, hidden)}
            {item.carry > 0 && ` (inclui ${money(item.carry, hidden)} de sobra)`}
            {item.month === null ? '' : ' · só este mês'}
          </span>
        </span>
        <span className={`budget-row__side num ${item.level === 'exceeded' ? 'expense' : ''}`}>
          {item.remaining >= 0
            ? `Restam ${money(item.remaining, hidden)}`
            : `${money(-item.remaining, hidden)} acima`}
          {item.level !== 'ok' && (
            <span className={`budget-tag budget-tag--${item.level}`}>{LEVEL_TEXT[item.level]}</span>
          )}
        </span>
      </button>
    </li>
  );
}

interface Draft {
  id: string | null;
  categoryId: string;
  amount: number;
  rollover: boolean;
  onlyThisMonth: boolean;
}

/** Orçamentos por categoria de despesa (RN 8): limite mensal, consumo e sobra acumulada. */
export function BudgetsPage() {
  const toast = useToast();
  const [month, setMonth] = useState(currentMonth());
  const budgets = useBudgets(month);
  const categories = useCategories();
  const { save, remove } = useBudgetMutations();
  const [draft, setDraft] = useState<Draft | null>(null);
  const { hidden } = useHiddenValues();

  const items = budgets.data?.items ?? [];
  const options = (categories.data ?? []).filter(
    (c) => c.kind === 'expense' && !c.isSystem && !c.archived && !c.parentId,
  );
  const used = new Set(items.map((i) => i.categoryId));
  const free = options.filter((c) => !used.has(c.id));

  const edit = (i: BudgetItem) =>
    setDraft({
      id: i.id,
      categoryId: i.categoryId,
      amount: i.limit,
      rollover: i.rollover,
      onlyThisMonth: i.month !== null,
    });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!draft?.categoryId) return;
    save.mutate(
      {
        categoryId: draft.categoryId,
        month: draft.onlyThisMonth ? month : null,
        amount: draft.amount,
        rollover: draft.rollover,
      },
      {
        onSuccess: () => {
          setDraft(null);
          toast({ text: 'Orçamento salvo.' });
        },
      },
    );
  };

  const totals = budgets.data?.totals;
  return (
    <>
      <PageHeader
        title="Orçamentos"
        back="/mais"
        action={
          free.length > 0 && !draft ? (
            <button
              type="button"
              className="btn btn--primary"
              onClick={() =>
                setDraft({
                  id: null,
                  categoryId: free[0]?.id ?? '',
                  amount: 0,
                  rollover: false,
                  onlyThisMonth: false,
                })
              }
            >
              Novo
            </button>
          ) : undefined
        }
      />

      <div className="month-nav" role="group" aria-label="Mês">
        <button
          type="button"
          className="icon-btn"
          aria-label="Mês anterior"
          onClick={() => setMonth((m) => addYearMonths(m, -1))}
        >
          <ChevronLeft size={20} aria-hidden="true" />
        </button>
        <span className="month-nav__label" aria-live="polite">
          {monthLabel(month)}
        </span>
        <button
          type="button"
          className="icon-btn"
          aria-label="Próximo mês"
          onClick={() => setMonth((m) => addYearMonths(m, 1))}
        >
          <ChevronRight size={20} aria-hidden="true" />
        </button>
      </div>

      {draft && (
        <form className="card card--pad form" onSubmit={submit}>
          <h2>{draft.id ? 'Editar orçamento' : 'Novo orçamento'}</h2>
          {save.isError && (
            <p className="alert alert--error" role="alert">
              {errorText(save.error)}
            </p>
          )}
          <div className="field">
            <label htmlFor="b-cat">Categoria</label>
            <select
              id="b-cat"
              className="input"
              value={draft.categoryId}
              disabled={draft.id !== null}
              onChange={(e) => setDraft({ ...draft, categoryId: e.target.value })}
            >
              {(draft.id ? options : free).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <p className="muted">Inclui as subcategorias.</p>
          </div>
          <div className="field">
            <label htmlFor="b-amount">Limite do mês</label>
            <MoneyInput
              id="b-amount"
              large
              autoFocus
              value={draft.amount}
              onChange={(amount) => setDraft({ ...draft, amount })}
            />
          </div>
          <label className="toggle">
            <input
              type="checkbox"
              checked={draft.onlyThisMonth}
              onChange={(e) => setDraft({ ...draft, onlyThisMonth: e.target.checked })}
            />
            <span>
              <strong>Só em {monthLabel(month)}</strong>
              <span className="muted">Desmarcado, vale para todo mês.</span>
            </span>
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={draft.rollover}
              onChange={(e) => setDraft({ ...draft, rollover: e.target.checked })}
            />
            <span>
              <strong>Acumular a sobra</strong>
              <span className="muted">O que não gastar soma no limite do mês seguinte.</span>
            </span>
          </label>
          <div className="form__actions">
            {draft.id && (
              <button
                type="button"
                className="btn btn--danger"
                onClick={() =>
                  remove.mutate(draft.id as string, {
                    onSuccess: () => {
                      setDraft(null);
                      toast({ text: 'Orçamento removido.' });
                    },
                  })
                }
              >
                <Trash2 size={18} aria-hidden="true" />
                Remover
              </button>
            )}
            <button type="button" className="btn" onClick={() => setDraft(null)}>
              Cancelar
            </button>
            <button type="submit" className="btn btn--primary" disabled={save.isPending}>
              Salvar
            </button>
          </div>
        </form>
      )}

      {budgets.isPending && <div className="skeleton" style={{ height: 200 }} />}
      {budgets.isError && (
        <p className="alert alert--error" role="alert">
          {errorText(budgets.error)}
        </p>
      )}
      {budgets.isSuccess && items.length === 0 && !draft && (
        <section className="card empty">
          <PiggyBank size={40} strokeWidth={1.5} aria-hidden="true" />
          <h2>Nenhum orçamento ainda</h2>
          <p className="muted">
            Defina quanto pode gastar por categoria no mês. O app avisa aos 80% e quando estourar.
          </p>
          {free.length > 0 && (
            <button
              type="button"
              className="btn btn--primary"
              onClick={() =>
                setDraft({
                  id: null,
                  categoryId: free[0]?.id ?? '',
                  amount: 0,
                  rollover: false,
                  onlyThisMonth: false,
                })
              }
            >
              Criar o primeiro
            </button>
          )}
        </section>
      )}
      {totals && items.length > 0 && (
        <section className="card card--pad budget-total" aria-label="Total do mês">
          <span className="muted">Gasto nos orçamentos</span>
          <strong className="num">
            {money(totals.spent, hidden)} de {money(totals.available, hidden)}
          </strong>
          <span className={`muted ${totals.remaining < 0 ? 'expense' : ''}`}>
            {totals.remaining >= 0
              ? `Restam ${money(totals.remaining, hidden)}`
              : `${money(-totals.remaining, hidden)} acima do total`}
          </span>
        </section>
      )}
      {items.length > 0 && (
        <ul className="list card">
          {items.map((i) => (
            <BudgetRow key={i.id} item={i} onEdit={() => edit(i)} />
          ))}
        </ul>
      )}
      <p className="muted">
        Conta o que já foi pago no mês. Compras no cartão entram no mês da fatura.
      </p>
    </>
  );
}
