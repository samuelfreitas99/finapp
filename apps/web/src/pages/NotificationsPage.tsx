import { BellRing, CheckCheck } from 'lucide-react';
import { useNavigate } from 'react-router';
import { PageHeader } from '../components/PageHeader';
import { useNotificationActions, useNotifications } from '../lib/queries';
import { errorText } from './transactions/EntryForm';

function relative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3_600_000);
  if (h < 1) return 'agora';
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'ontem' : `há ${d} dias`;
}

/** Central de notificações (alertas do dia). @see RN 9 */
export function NotificationsPage() {
  const list = useNotifications();
  const { read, readAll } = useNotificationActions();
  const navigate = useNavigate();
  const items = list.data?.items ?? [];
  return (
    <>
      <PageHeader
        title="Notificações"
        back="/"
        action={
          (list.data?.unread ?? 0) > 0 ? (
            <button type="button" className="btn btn--ghost" onClick={() => readAll.mutate()}>
              <CheckCheck size={18} aria-hidden="true" />
              Marcar lidas
            </button>
          ) : undefined
        }
      />
      {list.isPending && <div className="skeleton" style={{ height: 240 }} />}
      {list.isError && (
        <p className="alert alert--error" role="alert">
          {errorText(list.error)}
        </p>
      )}
      {list.isSuccess && items.length === 0 && (
        <section className="card empty">
          <BellRing size={40} strokeWidth={1.5} aria-hidden="true" />
          <h2>Tudo em dia</h2>
          <p className="muted">
            Os avisos de vencimentos, faturas e saldo aparecem aqui todo dia às 8h.
          </p>
        </section>
      )}
      {items.length > 0 && (
        <ul className="list card">
          {items.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                className={n.readAt ? 'row-link notice' : 'row-link notice notice--unread'}
                onClick={() => {
                  if (!n.readAt) read.mutate(n.id);
                  if (n.url) navigate(n.url);
                }}
              >
                <span className="row-link__main">
                  <span className="row-link__title">{n.title}</span>
                  <span className="row-link__meta">{n.body}</span>
                </span>
                <span className="row-link__meta">{relative(n.createdAt)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
