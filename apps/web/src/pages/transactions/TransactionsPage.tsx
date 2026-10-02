import { addYearMonths } from '@finapp/core';
import type { Transaction } from '@finapp/shared';
import {
  ArrowLeftRight,
  ChevronLeft,
  ChevronRight,
  ListOrdered,
  Plus,
  Scale,
  Search,
} from 'lucide-react';
import { useDeferredValue, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { PageHeader } from '../../components/PageHeader';
import { useToast } from '../../components/Toast';
import { categoryIcon } from '../../lib/category-icons';
import { currentMonth, dayLabel, monthLabel, monthRange, today } from '../../lib/dates';
import { money } from '../../lib/format';
import { useHiddenValues } from '../../lib/hidden-values';
import {
  useAccounts,
  useCategories,
  useSettleTransaction,
  useTransactions,
  type TransactionFilters,
} from '../../lib/queries';
import { errorText } from './EntryForm';

type Filter = 'all' | 'expense' | 'income' | 'transfer' | 'planned';

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'expense', label: 'Despesas' },
  { value: 'income', label: 'Receitas' },
  { value: 'transfer', label: 'Transferências' },
  { value: 'planned', label: 'Previstos' },
];

/** Efeito no saldo (positivo entra, negativo sai). */
function signed(t: Transaction): number {
  if (t.type === 'income' || t.type === 'transfer_in') return t.amount;
  if (t.type === 'adjustment') return t.amount;
  return -t.amount;
}

function toneOf(t: Transaction) {
  if (t.type === 'transfer_in' || t.type === 'transfer_out') return 'transfer';
  return signed(t) >= 0 ? 'income' : 'expense';
}

export function TransactionsPage() {
  const [month, setMonth] = useState(currentMonth);
  const [filter, setFilter] = useState<Filter>('all');
  const [accountId, setAccountId] = useState('');
  const [search, setSearch] = useState('');
  const q = useDeferredValue(search.trim());
  const { hidden } = useHiddenValues();
  const toast = useToast();

  const filters: TransactionFilters = {
    ...monthRange(month),
    accountId,
    q: q.length >= 2 ? q : '',
    status: filter === 'planned' ? 'planned' : '',
    type: filter === 'expense' || filter === 'income' ? filter : '',
  };
  const list = useTransactions(filters);
  const accounts = useAccounts({ includeArchived: true });
  const categories = useCategories();
  const settle = useSettleTransaction();

  const accountName = useMemo(
    () => new Map((accounts.data ?? []).map((a) => [a.id, a.name])),
    [accounts.data],
  );
  const categoryById = useMemo(
    () => new Map((categories.data ?? []).map((c) => [c.id, c])),
    [categories.data],
  );

  const items = (list.data?.pages.flatMap((p) => p.items) ?? []).filter(
    (t) => filter !== 'transfer' || t.transferId,
  );
  const days = new Map<string, Transaction[]>();
  for (const t of items) days.set(t.date, [...(days.get(t.date) ?? []), t]);
  const ref = today();

  const income = items.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const expense = items.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);

  return (
    <>
      <PageHeader
        title="Lançamentos"
        action={
          <Link to="/lancar" className="btn btn--primary">
            <Plus size={18} aria-hidden="true" />
            Lançar
          </Link>
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

      <div className="search">
        <Search size={18} aria-hidden="true" />
        <input
          className="input"
          type="search"
          placeholder="Buscar descrição, observação ou Pix"
          aria-label="Buscar lançamentos"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="chips" role="group" aria-label="Filtrar">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            className="chip"
            aria-pressed={filter === f.value}
            onClick={() => setFilter(f.value)}
          >
            {f.label}
          </button>
        ))}
        <select
          className="chip chip--select"
          aria-label="Conta"
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
        >
          <option value="">Todas as contas</option>
          {(accounts.data ?? []).map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </div>

      {list.isSuccess && items.length > 0 && filter === 'all' && (
        <div className="month-summary">
          <div className="card card--pad">
            <span className="muted">Entradas</span>
            <strong className="num income">{money(income, hidden, true)}</strong>
          </div>
          <div className="card card--pad">
            <span className="muted">Saídas</span>
            <strong className="num expense">{money(-expense, hidden, true)}</strong>
          </div>
        </div>
      )}

      {list.isPending && <div className="skeleton" style={{ height: 320 }} />}
      {list.isError && (
        <p className="alert alert--error" role="alert">
          {errorText(list.error)}{' '}
          <button type="button" className="btn btn--ghost" onClick={() => void list.refetch()}>
            Tentar de novo
          </button>
        </p>
      )}

      {list.isSuccess && items.length === 0 && (
        <section className="card empty">
          <ListOrdered size={40} strokeWidth={1.5} aria-hidden="true" />
          <h2>Nada em {monthLabel(month)}</h2>
          <p className="muted">
            {q || filter !== 'all' || accountId
              ? 'Nenhum lançamento com esses filtros.'
              : 'Use o + para lançar uma despesa, receita ou transferência.'}
          </p>
        </section>
      )}

      {[...days].map(([date, dayItems]) => {
        const net = dayItems.reduce((s, t) => s + signed(t), 0);
        return (
          <section key={date} className="day" aria-label={dayLabel(date, ref)}>
            <header className="day__head">
              <h2>{dayLabel(date, ref)}</h2>
              <span className="num muted">{money(net, hidden, true)}</span>
            </header>
            <ul className="list card">
              {dayItems.map((t) => {
                const cat = t.categoryId ? categoryById.get(t.categoryId) : undefined;
                const isTransfer = Boolean(t.transferId);
                const Icon = isTransfer
                  ? ArrowLeftRight
                  : t.type === 'adjustment'
                    ? Scale
                    : categoryIcon(cat?.icon);
                const planned = t.status === 'planned';
                const meta = [
                  isTransfer
                    ? `${t.type === 'transfer_out' ? 'Saiu de' : 'Entrou em'} ${accountName.get(t.accountId ?? '') ?? 'conta'}`
                    : [cat?.name, accountName.get(t.accountId ?? '')].filter(Boolean).join(', '),
                  t.paymentMethod === 'pix' ? 'Pix' : '',
                ]
                  .filter(Boolean)
                  .join(', ');
                return (
                  <li key={t.id} className={planned ? 'tx tx--planned' : 'tx'}>
                    <Link to={`/lancamentos/${t.id}`} className="row-link">
                      <span
                        className="avatar"
                        style={{
                          background: isTransfer
                            ? 'var(--transfer)'
                            : (cat?.color ?? 'var(--muted)'),
                        }}
                        aria-hidden="true"
                      >
                        <Icon size={18} />
                      </span>
                      <span className="row-link__main">
                        <span className="row-link__title">{t.description}</span>
                        <span className="row-link__meta">
                          {planned && <span className="pill">Previsto</span>}
                          {meta}
                        </span>
                      </span>
                      <strong className={`num ${toneOf(t)}`}>
                        {money(signed(t), hidden, true)}
                      </strong>
                    </Link>
                    {planned && (
                      <button
                        type="button"
                        className="btn tx__confirm"
                        disabled={settle.isPending}
                        onClick={() =>
                          settle.mutate(
                            { id: t.id },
                            {
                              onSuccess: () => toast({ text: `"${t.description}" confirmado.` }),
                              onError: (err) => toast({ text: errorText(err) }),
                            },
                          )
                        }
                      >
                        Confirmar
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      {list.hasNextPage && (
        <button
          type="button"
          className="btn"
          disabled={list.isFetchingNextPage}
          onClick={() => void list.fetchNextPage()}
        >
          {list.isFetchingNextPage ? 'Carregando…' : 'Carregar mais'}
        </button>
      )}
    </>
  );
}
