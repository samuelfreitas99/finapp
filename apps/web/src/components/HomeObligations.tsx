import { addYearMonths } from '@finapp/core';
import type { Card } from '@finapp/shared';
import { ChevronRight, CreditCard, HandCoins } from 'lucide-react';
import { Link } from 'react-router';
import { monthLabel } from '../lib/dates';
import { formatDate, money } from '../lib/format';
import { useHiddenValues } from '../lib/hidden-values';
import { useDebts, useInvoice } from '../lib/queries';

/**
 * Fatura que importa agora: a fechada que ainda falta pagar (vence primeiro) ou, se não
 * houver, a aberta.
 */
function CardRow({ card }: { card: Card }) {
  const { hidden } = useHiddenValues();
  const open = card.currentInvoice;
  const previous = useInvoice(card.id, addYearMonths(open.referenceMonth, -1));
  const prev = previous.data;
  const toPay = prev && prev.status !== 'open' && prev.status !== 'paid' && prev.remaining > 0;
  const inv = toPay ? prev : open;
  const text = toPay
    ? `Fatura de ${monthLabel(inv.referenceMonth)}: ${prev.status === 'overdue' ? 'venceu' : 'vence'} ${formatDate(inv.dueDate)}`
    : `Fatura de ${monthLabel(inv.referenceMonth)} aberta, fecha ${formatDate(inv.closingDate)}`;
  return (
    <li>
      <Link to={`/cartoes?cartao=${card.id}`} className="row-link">
        <span className="avatar" style={{ background: 'var(--hero)' }} aria-hidden="true">
          <CreditCard size={18} />
        </span>
        <span className="row-link__main">
          <span className="row-link__title">{card.name}</span>
          <span className={`row-link__meta${toPay && prev.status === 'overdue' ? ' expense' : ''}`}>
            {text}
          </span>
        </span>
        <strong className="num">{money(toPay ? inv.remaining : inv.total, hidden)}</strong>
        <ChevronRight size={18} aria-hidden="true" className="muted" />
      </Link>
    </li>
  );
}

function DebtsRow() {
  const { hidden } = useHiddenValues();
  const debts = useDebts();
  const owe = (debts.data ?? []).filter((d) => d.status === 'active' && d.direction === 'i_owe');
  if (owe.length === 0) return null;
  const total = owe.reduce((s, d) => s + d.summary.remainingAmount, 0);
  const next = owe
    .flatMap((d) => (d.next ? [{ ...d.next, name: d.name }] : []))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
  const late = owe.reduce((s, d) => s + d.summary.lateCount, 0);
  return (
    <li>
      <Link to="/dividas" className="row-link">
        <span className="avatar" style={{ background: 'var(--hero)' }} aria-hidden="true">
          <HandCoins size={18} />
        </span>
        <span className="row-link__main">
          <span className="row-link__title">
            Dívidas ({owe.length})
            {late > 0 && (
              <span className="pill pill--overdue">
                {late > 1 ? `${late} atrasadas` : 'atrasada'}
              </span>
            )}
          </span>
          <span className="row-link__meta">
            {next
              ? `Próxima: ${money(next.amount - next.paidAmount, hidden)} em ${formatDate(next.dueDate)}, ${next.name}`
              : 'Sem parcela pendente'}
          </span>
        </span>
        <strong className="num">{money(total, hidden)}</strong>
        <ChevronRight size={18} aria-hidden="true" className="muted" />
      </Link>
    </li>
  );
}

/** Início: faturas dos cartões e dívidas, em uma lista curta que leva às telas completas. */
export function HomeObligations({ cards }: { cards: Card[] }) {
  const debts = useDebts();
  const hasDebts = (debts.data ?? []).some((d) => d.status === 'active' && d.direction === 'i_owe');
  if (cards.length === 0 && !hasDebts) return null;
  return (
    <section className="stack" aria-labelledby="obligations-title">
      <h2 id="obligations-title">Cartões e dívidas</h2>
      <ul className="list card">
        {cards.map((c) => (
          <CardRow key={c.id} card={c} />
        ))}
        <DebtsRow />
      </ul>
    </section>
  );
}
