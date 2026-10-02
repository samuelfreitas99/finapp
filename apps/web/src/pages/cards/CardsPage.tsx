import { addYearMonths, parseISODate } from '@finapp/core';
import type { Card, InvoiceDetail } from '@finapp/shared';
import { ChevronLeft, ChevronRight, CreditCard, Pencil, Plus, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { MoneyInput } from '../../components/MoneyInput';
import { PageHeader } from '../../components/PageHeader';
import { useToast } from '../../components/Toast';
import { categoryIcon } from '../../lib/category-icons';
import { monthLabel, today } from '../../lib/dates';
import { formatDate, money, monthShort } from '../../lib/format';
import { useHiddenValues } from '../../lib/hidden-values';
import {
  useAccounts,
  useCards,
  useCategories,
  useInstallmentPlans,
  useInvoice,
  usePayInvoice,
  useUndoPayment,
} from '../../lib/queries';
import { errorText } from '../transactions/EntryForm';
import { PlanList } from './PlanList';

export const INVOICE_STATUS_LABEL: Record<string, string> = {
  open: 'Aberta',
  closed: 'Fechada',
  paid: 'Paga',
  partial: 'Paga em parte',
  overdue: 'Vencida',
};

function CardTile({
  card,
  selected,
  onSelect,
}: {
  card: Card;
  selected: boolean;
  onSelect: () => void;
}) {
  const { hidden } = useHiddenValues();
  const used = Math.max(0, card.limitAmount - card.availableLimit);
  const pct = card.limitAmount > 0 ? Math.min(100, (used / card.limitAmount) * 100) : 0;
  const inv = card.currentInvoice;
  const { month } = parseISODate(inv.dueDate);
  return (
    <button
      type="button"
      className="card-tile"
      aria-pressed={selected}
      onClick={onSelect}
      style={{ background: card.color ?? 'var(--hero)' }}
    >
      <span className="card-tile__name">{card.name}</span>
      <span className="card-tile__label">Fatura de {monthShort(month)}</span>
      <strong className="card-tile__value num">{money(inv.total, hidden)}</strong>
      <span className="card-tile__bar" aria-hidden="true">
        <span style={{ width: `${pct}%` }} />
      </span>
      <span className="card-tile__label num">Disponível {money(card.availableLimit, hidden)}</span>
    </button>
  );
}

function PayForm({
  card,
  invoice,
  onDone,
}: {
  card: Card;
  invoice: InvoiceDetail;
  onDone: () => void;
}) {
  const accounts = useAccounts();
  const pay = usePayInvoice(card.id, invoice.referenceMonth);
  const toast = useToast();
  const [amount, setAmount] = useState(invoice.remaining);
  const [accountId, setAccountId] = useState(card.paymentAccountId ?? accounts.data?.[0]?.id ?? '');
  const [date, setDate] = useState(today());
  const partial = amount > 0 && amount < invoice.remaining;
  return (
    <form
      className="card card--pad form"
      onSubmit={(e) => {
        e.preventDefault();
        pay.mutate(
          { amount, accountId, date },
          {
            onSuccess: () => {
              toast({ text: `Pagamento de ${money(amount)} registrado.` });
              onDone();
            },
          },
        );
      }}
    >
      <h3>Pagar fatura de {monthLabel(invoice.referenceMonth)}</h3>
      {pay.isError && (
        <p className="alert alert--error" role="alert">
          {errorText(pay.error)}
        </p>
      )}
      <div className="field">
        <label htmlFor="pay-amount">Valor</label>
        <MoneyInput id="pay-amount" value={amount} onChange={setAmount} replaceOnType />
        {partial && (
          <span className="muted field-hint">
            Pagamento parcial: depois do vencimento, o que faltar vai para a próxima fatura como
            saldo anterior.
          </span>
        )}
      </div>
      <div className="field">
        <label htmlFor="pay-account">Sai da conta</label>
        <select
          id="pay-account"
          className="input"
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
        >
          {(accounts.data ?? []).map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="pay-date">Data</label>
        <input
          id="pay-date"
          type="date"
          className="input"
          max={today()}
          value={date}
          onChange={(e) => e.target.value && setDate(e.target.value)}
        />
      </div>
      <div className="form-actions">
        <button type="button" className="btn" onClick={onDone}>
          Cancelar
        </button>
        <button
          type="submit"
          className="btn btn--primary"
          disabled={pay.isPending || amount <= 0 || !accountId}
        >
          {pay.isPending ? 'Pagando…' : `Pagar ${money(amount)}`}
        </button>
      </div>
    </form>
  );
}

function InvoiceView({ card, month }: { card: Card; month: string }) {
  const invoice = useInvoice(card.id, month);
  const categories = useCategories();
  const accounts = useAccounts({ includeArchived: true });
  const undo = useUndoPayment(card.id, month);
  const toast = useToast();
  const { hidden } = useHiddenValues();
  const [paying, setPaying] = useState(false);

  if (invoice.isPending) return <div className="skeleton" style={{ height: 300 }} />;
  if (invoice.isError) {
    return (
      <p className="alert alert--error" role="alert">
        {errorText(invoice.error)}
      </p>
    );
  }
  const inv = invoice.data;
  const catById = new Map((categories.data ?? []).map((c) => [c.id, c]));
  const accName = new Map((accounts.data ?? []).map((a) => [a.id, a.name]));

  return (
    <>
      <section className="card card--pad invoice-head" aria-label="Resumo da fatura">
        <div className="invoice-head__top">
          <span className={`pill pill--${inv.status}`}>{INVOICE_STATUS_LABEL[inv.status]}</span>
          <span className="muted">
            Fecha {formatDate(inv.closingDate)}, vence {formatDate(inv.dueDate)}
          </span>
        </div>
        <strong className="invoice-head__total num">{money(inv.total, hidden)}</strong>
        <dl className="invoice-head__rows">
          {inv.carried > 0 && (
            <div>
              <dt>Saldo anterior</dt>
              <dd className="num">{money(inv.carried, hidden)}</dd>
            </div>
          )}
          {inv.paid > 0 && (
            <div>
              <dt>Pago</dt>
              <dd className="num">{money(inv.paid, hidden)}</dd>
            </div>
          )}
          <div>
            <dt>Falta pagar</dt>
            <dd className="num">{money(inv.remaining, hidden)}</dd>
          </div>
        </dl>
        {inv.remaining > 0 && !paying && (
          <button type="button" className="btn btn--primary" onClick={() => setPaying(true)}>
            Pagar fatura
          </button>
        )}
      </section>

      {paying && <PayForm card={card} invoice={inv} onDone={() => setPaying(false)} />}

      {inv.payments.length > 0 && (
        <section className="stack" aria-labelledby="payments-title">
          <h2 id="payments-title">Pagamentos</h2>
          <ul className="list card">
            {inv.payments.map((p) => (
              <li key={p.id} className="row-link">
                <span className="row-link__main">
                  <span className="row-link__title num">{money(p.amount, hidden)}</span>
                  <span className="row-link__meta">
                    {formatDate(p.date)}, de {accName.get(p.accountId) ?? 'conta'}
                  </span>
                </span>
                <button
                  type="button"
                  className="btn btn--ghost"
                  disabled={undo.isPending}
                  onClick={() =>
                    undo.mutate(p.id, { onSuccess: () => toast({ text: 'Pagamento desfeito.' }) })
                  }
                >
                  <Undo2 size={16} aria-hidden="true" />
                  Desfazer
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="stack" aria-labelledby="items-title">
        <h2 id="items-title">Itens</h2>
        {inv.entries.length === 0 && inv.carried === 0 ? (
          <div className="card empty empty--compact">
            <p className="muted">Nenhuma compra nesta fatura.</p>
          </div>
        ) : (
          <ul className="list card">
            {inv.carried > 0 && (
              <li className="row-link">
                <span className="avatar" style={{ background: 'var(--muted)' }} aria-hidden="true">
                  <Undo2 size={18} />
                </span>
                <span className="row-link__main">
                  <span className="row-link__title">Saldo anterior</span>
                  <span className="row-link__meta">
                    Restante da fatura de {monthLabel(addYearMonths(month, -1))}
                  </span>
                </span>
                <strong className="num">{money(inv.carried, hidden)}</strong>
              </li>
            )}
            {inv.entries.map((t) => {
              const cat = t.categoryId ? catById.get(t.categoryId) : undefined;
              const Icon = categoryIcon(cat?.icon);
              const refund = t.type === 'income';
              return (
                <li key={t.id}>
                  <Link to={`/lancamentos/${t.id}`} className="row-link">
                    <span
                      className="avatar"
                      style={{
                        background: refund ? 'var(--income)' : (cat?.color ?? 'var(--muted)'),
                      }}
                      aria-hidden="true"
                    >
                      <Icon size={18} />
                    </span>
                    <span className="row-link__main">
                      <span className="row-link__title">{t.description}</span>
                      <span className="row-link__meta">
                        {formatDate(t.date)}
                        {cat ? `, ${cat.name}` : ''}
                        {t.anticipated ? ', antecipada' : ''}
                      </span>
                    </span>
                    <strong className={`num ${refund ? 'income' : ''}`}>
                      {money(refund ? -t.amount : t.amount, hidden)}
                    </strong>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}

export function CardsPage() {
  const cards = useCards();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<'invoice' | 'plans'>('invoice');
  const items = cards.data ?? [];
  const selected = items.find((c) => c.id === params.get('cartao')) ?? items[0];
  const month = params.get('mes') ?? selected?.currentInvoice.referenceMonth ?? '';
  const plans = useInstallmentPlans({ status: 'active', cardId: selected?.id });

  const select = (next: Record<string, string>) =>
    setParams(
      (p) => {
        const copy = new URLSearchParams(p);
        for (const [k, v] of Object.entries(next)) copy.set(k, v);
        return copy;
      },
      { replace: true },
    );

  return (
    <>
      <PageHeader
        title="Cartões"
        action={
          <Link to="/cartoes/novo" className="btn btn--primary">
            <Plus size={18} aria-hidden="true" />
            Novo cartão
          </Link>
        }
      />

      {cards.isPending && <div className="skeleton" style={{ height: 180 }} />}
      {cards.isError && (
        <p className="alert alert--error" role="alert">
          {errorText(cards.error)}
        </p>
      )}

      {cards.isSuccess && items.length === 0 && (
        <section className="card empty">
          <CreditCard size={40} strokeWidth={1.5} aria-hidden="true" />
          <h2>Cadastre seu primeiro cartão</h2>
          <p className="muted">
            Com o dia de fechamento e de vencimento, o FinApp põe cada compra na fatura certa e
            mostra o limite disponível.
          </p>
          <Link to="/cartoes/novo" className="btn btn--primary">
            <Plus size={18} aria-hidden="true" />
            Novo cartão
          </Link>
        </section>
      )}

      {selected && (
        <>
          <div className="card-strip" role="group" aria-label="Cartões">
            {items.map((c) => (
              <CardTile
                key={c.id}
                card={c}
                selected={c.id === selected.id}
                onSelect={() => select({ cartao: c.id, mes: c.currentInvoice.referenceMonth })}
              />
            ))}
          </div>

          <div className="card-meta">
            <span className="muted">
              Fecha dia {selected.closingDay}, vence dia {selected.dueDay}. Melhor dia de compra:{' '}
              {selected.bestPurchaseDay}.
            </span>
            <Link to={`/cartoes/${selected.id}/editar`} className="btn btn--ghost">
              <Pencil size={16} aria-hidden="true" />
              Editar
            </Link>
          </div>

          <div className="segmented" role="group" aria-label="Ver">
            <button
              type="button"
              aria-pressed={tab === 'invoice'}
              onClick={() => setTab('invoice')}
            >
              Fatura
            </button>
            <button type="button" aria-pressed={tab === 'plans'} onClick={() => setTab('plans')}>
              Parcelamentos{plans.data?.length ? ` (${plans.data.length})` : ''}
            </button>
          </div>

          {tab === 'invoice' ? (
            <>
              <div className="month-nav" role="group" aria-label="Fatura do mês">
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Fatura anterior"
                  onClick={() => select({ mes: addYearMonths(month, -1) })}
                >
                  <ChevronLeft size={20} aria-hidden="true" />
                </button>
                <span className="month-nav__label" aria-live="polite">
                  {monthLabel(month)}
                </span>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Próxima fatura"
                  onClick={() => select({ mes: addYearMonths(month, 1) })}
                >
                  <ChevronRight size={20} aria-hidden="true" />
                </button>
              </div>
              <InvoiceView key={`${selected.id}-${month}`} card={selected} month={month} />
            </>
          ) : (
            <PlanList plans={plans.data} pending={plans.isPending} />
          )}
        </>
      )}
    </>
  );
}
