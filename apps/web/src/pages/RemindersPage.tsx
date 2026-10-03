import type { Reminder, ReminderRepeat } from '@finapp/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ListChecks, Plus, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { PageHeader } from '../components/PageHeader';
import { useToast } from '../components/Toast';
import { api } from '../lib/api';
import { errorText } from './transactions/EntryForm';

const KEY = ['reminders'];
const REPEAT_LABEL: Record<ReminderRepeat, string> = {
  none: 'Não repete',
  daily: 'Todo dia',
  weekly: 'Toda semana',
  monthly: 'Todo mês',
  yearly: 'Todo ano',
};

function when(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

/** Lembretes e checklist, com aviso no horário (push). */
export function RemindersPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const list = useQuery({
    queryKey: KEY,
    queryFn: () => api<{ items: Reminder[] }>('/api/reminders').then((r) => r.items),
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: KEY });
  const create = useMutation({
    mutationFn: (body: unknown) => api<Reminder>('/api/reminders', { method: 'POST', body }),
    onSuccess: invalidate,
  });
  const update = useMutation({
    mutationFn: ({ id, ...body }: { id: string; done?: boolean }) =>
      api<Reminder>(`/api/reminders/${id}`, { method: 'PATCH', body }),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/reminders/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
  const [title, setTitle] = useState('');
  const [at, setAt] = useState('');
  const [repeat, setRepeat] = useState<ReminderRepeat>('none');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    create.mutate(
      {
        title: title.trim(),
        dueAt: at ? new Date(at).toISOString() : null,
        repeat: at ? repeat : 'none',
      },
      {
        onSuccess: () => {
          setTitle('');
          setAt('');
          setRepeat('none');
          toast({
            text: at ? 'Lembrete criado. Você recebe um aviso no horário.' : 'Item adicionado.',
          });
        },
      },
    );
  };

  const items = list.data ?? [];
  return (
    <>
      <PageHeader title="Lembretes" back="/mais" />
      <form className="card card--pad form" onSubmit={submit}>
        {create.isError && (
          <p className="alert alert--error" role="alert">
            {errorText(create.error)}
          </p>
        )}
        <div className="field">
          <label htmlFor="r-title">O que lembrar</label>
          <input
            id="r-title"
            className="input"
            maxLength={200}
            placeholder="Ex.: Pagar IPVA, levar documentos ao banco"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="r-at">Avisar em (opcional)</label>
            <input
              id="r-at"
              type="datetime-local"
              className="input"
              value={at}
              onChange={(e) => setAt(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="r-repeat">Repetir</label>
            <select
              id="r-repeat"
              className="input"
              value={repeat}
              disabled={!at}
              onChange={(e) => setRepeat(e.target.value as ReminderRepeat)}
            >
              {(Object.keys(REPEAT_LABEL) as ReminderRepeat[]).map((r) => (
                <option key={r} value={r}>
                  {REPEAT_LABEL[r]}
                </option>
              ))}
            </select>
          </div>
        </div>
        <button
          type="submit"
          className="btn btn--primary"
          disabled={!title.trim() || create.isPending}
        >
          <Plus size={18} aria-hidden="true" />
          Adicionar
        </button>
      </form>

      {list.isPending && <div className="skeleton" style={{ height: 200 }} />}
      {list.isSuccess && items.length === 0 && (
        <section className="card empty">
          <ListChecks size={40} strokeWidth={1.5} aria-hidden="true" />
          <h2>Nada pendente</h2>
          <p className="muted">Anote o que não pode esquecer. Com horário, o celular avisa.</p>
        </section>
      )}
      {items.length > 0 && (
        <ul className="list card">
          {items.map((r) => (
            <li
              key={r.id}
              className={r.done ? 'row-link reminder reminder--done' : 'row-link reminder'}
            >
              <label className="toggle reminder__check">
                <input
                  type="checkbox"
                  checked={r.done}
                  aria-label={r.done ? `Reabrir ${r.title}` : `Concluir ${r.title}`}
                  onChange={(e) =>
                    update.mutate(
                      { id: r.id, done: e.target.checked },
                      {
                        onSuccess: (next) => {
                          if (e.target.checked && !next.done && next.dueAt) {
                            toast({ text: `Feito. Próximo aviso: ${when(next.dueAt)}.` });
                          }
                        },
                      },
                    )
                  }
                />
                <span>
                  <strong>{r.title}</strong>
                  {r.dueAt && (
                    <span className="muted">
                      {when(r.dueAt)}
                      {r.repeat !== 'none' ? `, ${REPEAT_LABEL[r.repeat].toLowerCase()}` : ''}
                    </span>
                  )}
                </span>
              </label>
              <button
                type="button"
                className="icon-btn"
                aria-label={`Apagar ${r.title}`}
                onClick={() => remove.mutate(r.id)}
              >
                <Trash2 size={18} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
