import type { Recurrence } from '@finapp/shared';
import { ChevronRight, Plus, Repeat } from 'lucide-react';
import { Link } from 'react-router';
import { PageHeader } from '../../components/PageHeader';
import { categoryIcon } from '../../lib/category-icons';
import { formatDate, money } from '../../lib/format';
import { useHiddenValues } from '../../lib/hidden-values';
import { useCategories, useRecurrences } from '../../lib/queries';
import { recurrenceText } from '../../lib/recurrence-text';
import { errorText } from '../transactions/EntryForm';

function Group({ title, items }: { title: string; items: Recurrence[] }) {
  const { hidden } = useHiddenValues();
  const categories = useCategories();
  const catById = new Map((categories.data ?? []).map((c) => [c.id, c]));
  if (!items.length) return null;
  const monthly = items
    .filter((r) => r.frequency === 'monthly' && !r.endDate)
    .reduce((s, r) => s + r.amount, 0);
  return (
    <section className="stack" aria-label={title}>
      <div className="section-head">
        <h2>{title}</h2>
        {monthly > 0 && <span className="muted num">{money(monthly, hidden)} por mês</span>}
      </div>
      <ul className="list card">
        {items.map((r) => {
          const cat = r.categoryId ? catById.get(r.categoryId) : undefined;
          const Icon = categoryIcon(cat?.icon);
          const next = r.next[0];
          return (
            <li key={r.id}>
              <Link to={`/fixas/${r.id}`} className="row-link">
                <span
                  className="avatar"
                  style={{ background: cat?.color ?? 'var(--muted)' }}
                  aria-hidden="true"
                >
                  <Icon size={18} />
                </span>
                <span className="row-link__main">
                  <span className="row-link__title">{r.description}</span>
                  <span className="row-link__meta">
                    {recurrenceText(r)}
                    {r.variableAmount ? ', valor variável' : ''}
                    {next ? `. Próxima: ${formatDate(next.date)}` : ''}
                    {r.endDate ? `. Até ${formatDate(r.endDate)}` : ''}
                  </span>
                </span>
                <strong className={`num ${r.type === 'income' ? 'income' : ''}`}>
                  {money(r.amount, hidden)}
                </strong>
                <ChevronRight size={18} aria-hidden="true" className="muted" />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Receitas e despesas fixas (recorrências). @see RN 3 */
export function RecurrencesPage() {
  const list = useRecurrences();
  const items = list.data ?? [];
  return (
    <>
      <PageHeader
        title="Fixas"
        back="/mais"
        action={
          <Link to="/fixas/nova" className="btn btn--primary">
            <Plus size={18} aria-hidden="true" />
            Nova
          </Link>
        }
      />
      <p className="muted">
        Salário, aluguel, assinaturas, contas do mês. Cada uma gera os lançamentos previstos dos
        próximos 12 meses.
      </p>
      {list.isPending && <div className="skeleton" style={{ height: 240 }} />}
      {list.isError && (
        <p className="alert alert--error" role="alert">
          {errorText(list.error)}
        </p>
      )}
      {list.isSuccess && items.length === 0 && (
        <section className="card empty">
          <Repeat size={40} strokeWidth={1.5} aria-hidden="true" />
          <h2>Cadastre o que se repete</h2>
          <p className="muted">
            Comece pelo salário (dá para dividir em adiantamento e restante) e pelas contas fixas.
          </p>
          <Link to="/fixas/nova" className="btn btn--primary">
            <Plus size={18} aria-hidden="true" />
            Nova recorrência
          </Link>
        </section>
      )}
      <Group title="Receitas" items={items.filter((r) => r.type === 'income')} />
      <Group title="Despesas" items={items.filter((r) => r.type === 'expense')} />
    </>
  );
}
