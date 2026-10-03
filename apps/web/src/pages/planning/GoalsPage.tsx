import type { Goal } from '@finapp/shared';
import { Archive, Flag, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { MoneyInput } from '../../components/MoneyInput';
import { PageHeader } from '../../components/PageHeader';
import { useToast } from '../../components/Toast';
import { formatDate, money } from '../../lib/format';
import { useHiddenValues } from '../../lib/hidden-values';
import { useAccounts, useGoalMutations, useGoals } from '../../lib/queries';
import { errorText } from '../transactions/EntryForm';

interface Draft {
  id: string | null;
  name: string;
  targetAmount: number;
  targetDate: string;
  accountId: string;
  savedAmount: number;
}

const EMPTY: Draft = {
  id: null,
  name: '',
  targetAmount: 0,
  targetDate: '',
  accountId: '',
  savedAmount: 0,
};

const STATUS_TEXT: Record<Goal['status'], string> = {
  done: 'Meta batida',
  on_track: '',
  overdue: 'Prazo vencido',
  no_date: 'Sem prazo',
};

function GoalCard({
  goal,
  onEdit,
  onDeposit,
}: {
  goal: Goal;
  onEdit: () => void;
  onDeposit: () => void;
}) {
  const { hidden } = useHiddenValues();
  const pct = Math.round(goal.ratio * 100);
  return (
    <li className="goal-row">
      <div className="goal-row__head">
        <strong>{goal.name}</strong>
        {STATUS_TEXT[goal.status] && (
          <span className={`budget-tag budget-tag--${goal.status === 'done' ? 'ok' : 'warning'}`}>
            {STATUS_TEXT[goal.status]}
          </span>
        )}
      </div>
      <span
        className="progress progress--large"
        role="progressbar"
        aria-label={`${goal.name}: ${pct}% da meta`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        <span className="budget-bar budget-bar--ok" style={{ width: `${pct}%` }} />
      </span>
      <span className="muted">
        {money(goal.saved, hidden)} de {money(goal.targetAmount, hidden)} ({pct}%)
        {goal.accountName ? ` · saldo de ${goal.accountName}` : ''}
      </span>
      {goal.status === 'on_track' && goal.suggestedMonthly !== null && (
        <span>
          Guarde <strong className="num">{money(goal.suggestedMonthly, hidden)}</strong> por mês até{' '}
          {goal.targetDate ? formatDate(goal.targetDate) : ''} ({goal.monthsLeft}{' '}
          {goal.monthsLeft === 1 ? 'mês' : 'meses'}).
        </span>
      )}
      {goal.status === 'overdue' && (
        <span>Faltam {money(goal.remaining, hidden)}. Ajuste o prazo para recalcular.</span>
      )}
      {goal.status === 'no_date' && (
        <span className="muted">
          Falta {money(goal.remaining, hidden)}. Defina um prazo para ver o aporte mensal.
        </span>
      )}
      <div className="form__actions">
        {!goal.accountId && !goal.archived && (
          <button type="button" className="btn" onClick={onDeposit}>
            Guardar / retirar
          </button>
        )}
        <button type="button" className="btn" onClick={onEdit}>
          Editar
        </button>
      </div>
    </li>
  );
}

/** Metas de poupança (RN 8): alvo, prazo, aporte mensal sugerido. */
export function GoalsPage() {
  const toast = useToast();
  const goals = useGoals();
  const accounts = useAccounts();
  const { create, update, deposit, remove } = useGoalMutations();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dep, setDep] = useState<{ id: string; name: string; amount: number; out: boolean } | null>(
    null,
  );
  const [showArchived, setShowArchived] = useState(false);

  const all = goals.data ?? [];
  const items = all.filter((g) => !g.archived);
  const archived = all.filter((g) => g.archived);
  const error = create.error ?? update.error ?? deposit.error ?? remove.error;

  const edit = (g: Goal) =>
    setDraft({
      id: g.id,
      name: g.name,
      targetAmount: g.targetAmount,
      targetDate: g.targetDate ?? '',
      accountId: g.accountId ?? '',
      savedAmount: 0,
    });

  const done = (text: string) => {
    setDraft(null);
    setDep(null);
    toast({ text });
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!draft || !draft.name.trim() || draft.targetAmount <= 0) return;
    if (draft.id) {
      update.mutate(
        {
          id: draft.id,
          name: draft.name.trim(),
          targetAmount: draft.targetAmount,
          targetDate: draft.targetDate || null,
          accountId: draft.accountId || null,
        },
        { onSuccess: () => done('Meta salva.') },
      );
    } else {
      create.mutate(
        {
          name: draft.name.trim(),
          targetAmount: draft.targetAmount,
          targetDate: draft.targetDate || null,
          accountId: draft.accountId || null,
          savedAmount: draft.accountId ? 0 : draft.savedAmount,
        },
        { onSuccess: () => done('Meta criada.') },
      );
    }
  };

  return (
    <>
      <PageHeader
        title="Metas"
        back="/mais"
        action={
          !draft ? (
            <button type="button" className="btn btn--primary" onClick={() => setDraft(EMPTY)}>
              Nova
            </button>
          ) : undefined
        }
      />
      {error && (
        <p className="alert alert--error" role="alert">
          {errorText(error)}
        </p>
      )}

      {draft && (
        <form className="card card--pad form" onSubmit={submit}>
          <h2>{draft.id ? 'Editar meta' : 'Nova meta'}</h2>
          <div className="field">
            <label htmlFor="g-name">Nome</label>
            <input
              id="g-name"
              className="input"
              maxLength={120}
              placeholder="Ex.: Viagem, reserva de emergência"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="g-target">Valor da meta</label>
            <MoneyInput
              id="g-target"
              large
              value={draft.targetAmount}
              onChange={(targetAmount) => setDraft({ ...draft, targetAmount })}
            />
          </div>
          <div className="field">
            <label htmlFor="g-date">Prazo (opcional)</label>
            <input
              id="g-date"
              type="date"
              className="input"
              value={draft.targetDate}
              onChange={(e) => setDraft({ ...draft, targetDate: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="g-account">Conta da meta (opcional)</label>
            <select
              id="g-account"
              className="input"
              value={draft.accountId}
              onChange={(e) => setDraft({ ...draft, accountId: e.target.value })}
            >
              <option value="">Nenhuma: eu marco quanto guardei</option>
              {(accounts.data ?? []).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            <p className="muted">
              Com conta, o guardado é o saldo dela e os aportes são transferências para ela.
            </p>
          </div>
          {!draft.id && !draft.accountId && (
            <div className="field">
              <label htmlFor="g-saved">Já guardado</label>
              <MoneyInput
                id="g-saved"
                value={draft.savedAmount}
                onChange={(savedAmount) => setDraft({ ...draft, savedAmount })}
              />
            </div>
          )}
          <div className="form__actions">
            {draft.id && (
              <>
                <button
                  type="button"
                  className="btn btn--danger"
                  onClick={() =>
                    remove.mutate(draft.id as string, { onSuccess: () => done('Meta removida.') })
                  }
                >
                  <Trash2 size={18} aria-hidden="true" />
                  Remover
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() =>
                    update.mutate(
                      {
                        id: draft.id as string,
                        archived: !all.find((g) => g.id === draft.id)?.archived,
                      },
                      { onSuccess: () => done('Meta atualizada.') },
                    )
                  }
                >
                  <Archive size={18} aria-hidden="true" />
                  {all.find((g) => g.id === draft.id)?.archived ? 'Reabrir' : 'Arquivar'}
                </button>
              </>
            )}
            <button type="button" className="btn" onClick={() => setDraft(null)}>
              Cancelar
            </button>
            <button
              type="submit"
              className="btn btn--primary"
              disabled={!draft.name.trim() || draft.targetAmount <= 0}
            >
              Salvar
            </button>
          </div>
        </form>
      )}

      {dep && (
        <form
          className="card card--pad form"
          onSubmit={(e) => {
            e.preventDefault();
            if (dep.amount <= 0) return;
            deposit.mutate(
              { id: dep.id, amount: dep.out ? -dep.amount : dep.amount },
              { onSuccess: () => done(dep.out ? 'Retirada registrada.' : 'Aporte registrado.') },
            );
          }}
        >
          <h2>{dep.name}</h2>
          <div className="segmented" role="group" aria-label="Tipo">
            <button
              type="button"
              aria-pressed={!dep.out}
              onClick={() => setDep({ ...dep, out: false })}
            >
              Guardar
            </button>
            <button
              type="button"
              aria-pressed={dep.out}
              onClick={() => setDep({ ...dep, out: true })}
            >
              Retirar
            </button>
          </div>
          <div className="field">
            <label htmlFor="g-dep">Valor</label>
            <MoneyInput
              id="g-dep"
              large
              autoFocus
              value={dep.amount}
              onChange={(amount) => setDep({ ...dep, amount })}
            />
          </div>
          <div className="form__actions">
            <button type="button" className="btn" onClick={() => setDep(null)}>
              Cancelar
            </button>
            <button type="submit" className="btn btn--primary" disabled={dep.amount <= 0}>
              Confirmar
            </button>
          </div>
        </form>
      )}

      {goals.isPending && <div className="skeleton" style={{ height: 200 }} />}
      {goals.isSuccess && items.length === 0 && !draft && (
        <section className="card empty">
          <Flag size={40} strokeWidth={1.5} aria-hidden="true" />
          <h2>Nenhuma meta ainda</h2>
          <p className="muted">
            Defina quanto quer juntar e até quando. O app calcula quanto guardar por mês.
          </p>
          <button type="button" className="btn btn--primary" onClick={() => setDraft(EMPTY)}>
            Criar a primeira
          </button>
        </section>
      )}
      {items.length > 0 && (
        <ul className="list card">
          {items.map((g) => (
            <GoalCard
              key={g.id}
              goal={g}
              onEdit={() => edit(g)}
              onDeposit={() => setDep({ id: g.id, name: g.name, amount: 0, out: false })}
            />
          ))}
        </ul>
      )}
      {archived.length > 0 && (
        <>
          <button type="button" className="btn" onClick={() => setShowArchived((v) => !v)}>
            {showArchived ? 'Ocultar arquivadas' : `Arquivadas (${archived.length})`}
          </button>
          {showArchived && (
            <ul className="list card">
              {archived.map((g) => (
                <GoalCard key={g.id} goal={g} onEdit={() => edit(g)} onDeposit={() => undefined} />
              ))}
            </ul>
          )}
        </>
      )}
    </>
  );
}
