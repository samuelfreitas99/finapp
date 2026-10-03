import type { Category, CategoryKind } from '@finapp/shared';
import { useQuery } from '@tanstack/react-query';
import { Archive, Plus, Trash2 } from 'lucide-react';
import { createElement, useState, type FormEvent } from 'react';
import { PageHeader } from '../../components/PageHeader';
import { useToast } from '../../components/Toast';
import { api, spacePath } from '../../lib/api';
import { categoryIcon, ICON_NAMES } from '../../lib/category-icons';
import { keys, useCategoryMutations, useSpaceId } from '../../lib/queries';
import { errorText } from '../transactions/EntryForm';

const COLORS = [
  '#1f3a68',
  '#2f6f4f',
  '#a23a28',
  '#b7791f',
  '#6b46c1',
  '#0e7490',
  '#be185d',
  '#64748b',
];

interface Draft {
  id: string | null;
  kind: CategoryKind;
  name: string;
  parentId: string;
  color: string;
  icon: string;
  archived: boolean;
}

function Row({ cat, child, onEdit }: { cat: Category; child?: boolean; onEdit: () => void }) {
  return (
    <li className={child ? 'row-link cat-row cat-row--child' : 'row-link cat-row'}>
      <button type="button" className="row-link__btn cat-row__btn" onClick={onEdit}>
        <span className="cat-dot" style={{ background: cat.color ?? 'var(--muted)' }}>
          {createElement(categoryIcon(cat.icon), { size: 16, 'aria-hidden': true })}
        </span>
        <span className="row-link__main">
          <strong>{cat.name}</strong>
          {cat.archived && <span className="muted">Arquivada</span>}
        </span>
      </button>
    </li>
  );
}

/** Categorias de despesa e receita, com subcategorias de um nível. */
export function CategoriesPage() {
  const toast = useToast();
  const spaceId = useSpaceId();
  const [kind, setKind] = useState<CategoryKind>('expense');
  const [draft, setDraft] = useState<Draft | null>(null);
  const { create, update, remove } = useCategoryMutations();
  const list = useQuery({
    queryKey: [...keys.categories(spaceId), 'manage'],
    queryFn: () =>
      api<{ items: Category[] }>(spacePath(spaceId, '/categories?includeArchived=true')).then(
        (r) => r.items,
      ),
  });
  const all = (list.data ?? []).filter((c) => c.kind === kind);
  const parents = all.filter((c) => !c.parentId);
  const childrenOf = (id: string) => all.filter((c) => c.parentId === id);
  const error = list.error ?? create.error ?? update.error ?? remove.error;

  const open = (c?: Category) =>
    setDraft({
      id: c?.id ?? null,
      kind: c?.kind ?? kind,
      name: c?.name ?? '',
      parentId: c?.parentId ?? '',
      color: c?.color ?? COLORS[0] ?? '#1f3a68',
      icon: c?.icon ?? 'tag',
      archived: c?.archived ?? false,
    });
  const close = (text: string) => {
    setDraft(null);
    toast({ text });
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!draft || !draft.name.trim()) return;
    const common = { name: draft.name.trim(), color: draft.color, icon: draft.icon };
    if (draft.id) {
      update.mutate(
        { id: draft.id, ...common, parentId: draft.parentId || null },
        { onSuccess: () => close('Categoria salva.') },
      );
    } else {
      create.mutate(
        { ...common, kind: draft.kind, parentId: draft.parentId || null },
        { onSuccess: () => close('Categoria criada.') },
      );
    }
  };

  const editing = draft?.id ? all.find((c) => c.id === draft.id) : undefined;
  const hasChildren = draft?.id ? childrenOf(draft.id).length > 0 : false;

  return (
    <>
      <PageHeader
        title="Categorias"
        back="/mais"
        action={
          !draft ? (
            <button type="button" className="btn btn--primary" onClick={() => open()}>
              <Plus size={18} aria-hidden="true" />
              Nova
            </button>
          ) : undefined
        }
      />
      <div className="segmented" role="group" aria-label="Tipo">
        <button type="button" aria-pressed={kind === 'expense'} onClick={() => setKind('expense')}>
          Despesas
        </button>
        <button type="button" aria-pressed={kind === 'income'} onClick={() => setKind('income')}>
          Receitas
        </button>
      </div>
      {error && (
        <p className="alert alert--error" role="alert">
          {errorText(error)}
        </p>
      )}

      {draft && (
        <form className="card card--pad form" onSubmit={submit}>
          <h2>
            {draft.id
              ? 'Editar categoria'
              : draft.kind === 'expense'
                ? 'Nova categoria de despesa'
                : 'Nova categoria de receita'}
          </h2>
          <div className="field">
            <label htmlFor="cat-name">Nome</label>
            <input
              id="cat-name"
              className="input"
              maxLength={120}
              autoFocus
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="cat-parent">Dentro de (opcional)</label>
            <select
              id="cat-parent"
              className="input"
              value={draft.parentId}
              disabled={hasChildren}
              onChange={(e) => setDraft({ ...draft, parentId: e.target.value })}
            >
              <option value="">Nenhuma: categoria principal</option>
              {parents
                .filter((p) => p.id !== draft.id && !p.archived)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
            {hasChildren && <p className="muted">Tem subcategorias, então não pode virar uma.</p>}
          </div>
          <fieldset className="field">
            <legend>Cor</legend>
            <div className="swatches">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className="swatch"
                  style={{ background: c }}
                  aria-label={`Cor ${c}`}
                  aria-pressed={draft.color === c}
                  onClick={() => setDraft({ ...draft, color: c })}
                />
              ))}
            </div>
          </fieldset>
          <fieldset className="field">
            <legend>Ícone</legend>
            <div className="swatches">
              {ICON_NAMES.map((n) => {
                const Icon = categoryIcon(n);
                return (
                  <button
                    key={n}
                    type="button"
                    className="swatch swatch--icon"
                    aria-label={`Ícone ${n}`}
                    aria-pressed={draft.icon === n}
                    onClick={() => setDraft({ ...draft, icon: n })}
                  >
                    <Icon size={18} aria-hidden="true" />
                  </button>
                );
              })}
            </div>
          </fieldset>
          <div className="form__actions">
            {editing && (
              <>
                <button
                  type="button"
                  className="btn btn--danger"
                  onClick={() => {
                    if (
                      window.confirm(
                        `Excluir "${editing.name}"? Os lançamentos continuam, sem essa categoria.`,
                      )
                    ) {
                      remove.mutate(editing.id, { onSuccess: () => close('Categoria excluída.') });
                    }
                  }}
                >
                  <Trash2 size={18} aria-hidden="true" />
                  Excluir
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() =>
                    update.mutate(
                      { id: editing.id, archived: !editing.archived },
                      {
                        onSuccess: () =>
                          close(editing.archived ? 'Categoria reativada.' : 'Categoria arquivada.'),
                      },
                    )
                  }
                >
                  <Archive size={18} aria-hidden="true" />
                  {editing.archived ? 'Reativar' : 'Arquivar'}
                </button>
              </>
            )}
            <button type="button" className="btn" onClick={() => setDraft(null)}>
              Cancelar
            </button>
            <button type="submit" className="btn btn--primary" disabled={!draft.name.trim()}>
              Salvar
            </button>
          </div>
        </form>
      )}

      {list.isPending && <div className="skeleton" style={{ height: 200 }} />}
      {list.isSuccess && (
        <ul className="list card">
          {parents.map((p) => (
            <li key={p.id} className="cat-group">
              <ul className="list">
                <Row cat={p} onEdit={() => open(p)} />
                {childrenOf(p.id).map((c) => (
                  <Row key={c.id} cat={c} child onEdit={() => open(c)} />
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
      <p className="muted">
        Arquivar esconde a categoria nos novos lançamentos sem apagar o histórico. As categorias
        técnicas (pagamento de fatura, transferência, ajuste, empréstimo) são do sistema e não
        aparecem aqui.
      </p>
    </>
  );
}
