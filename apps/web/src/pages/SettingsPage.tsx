import type { NotificationSettings, NotificationType } from '@finapp/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, BellOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { useToast } from '../components/Toast';
import { api } from '../lib/api';
import { currentSubscription, disablePush, enablePush, pushSupported } from '../lib/push';
import { errorText } from './transactions/EntryForm';

const TYPE_LABEL: Record<NotificationType, { label: string; days?: boolean }> = {
  due_soon: { label: 'Contas e parcelas a vencer', days: true },
  overdue: { label: 'Vencidos e não pagos' },
  invoice_closing: { label: 'Fatura fecha amanhã' },
  invoice_closed: { label: 'Fatura fechou' },
  invoice_due: { label: 'Fatura a vencer', days: true },
  income_unconfirmed: { label: 'Receita prevista não confirmada' },
  negative_forecast: { label: 'Saldo previsto negativo' },
  budget: { label: 'Orçamento perto do limite' },
  card_limit: { label: 'Limite do cartão acima de 80%' },
  split_pending: { label: 'Racha com saldo pendente' },
  reminder: { label: 'Lembretes no horário' },
};

const KEY = ['notification-settings'];

function PushCard() {
  const toast = useToast();
  const [state, setState] = useState<'loading' | 'on' | 'off' | 'unsupported'>(() =>
    pushSupported() ? 'loading' : 'unsupported',
  );
  useEffect(() => {
    if (!pushSupported()) return;
    currentSubscription()
      .then((s) => setState(s && Notification.permission === 'granted' ? 'on' : 'off'))
      .catch(() => setState('off'));
  }, []);
  const toggle = useMutation({
    mutationFn: () => (state === 'on' ? disablePush() : enablePush()),
    onSuccess: () => {
      setState((s) => (s === 'on' ? 'off' : 'on'));
      toast({
        text: state === 'on' ? 'Notificações desligadas neste aparelho.' : 'Notificações ligadas.',
      });
    },
  });
  const test = useMutation({
    mutationFn: () => api<{ sent: number }>('/api/push/test', { method: 'POST', body: {} }),
    onSuccess: (r) =>
      toast({ text: r.sent ? 'Enviamos uma notificação de teste.' : 'Nenhum aparelho inscrito.' }),
  });
  const error = toggle.error ?? test.error;
  return (
    <section className="card card--pad form" aria-labelledby="push-title">
      <h2 id="push-title">Notificações no aparelho</h2>
      {state === 'unsupported' ? (
        <p className="muted">
          Este navegador não recebe notificações. No iPhone, instale o FinApp na tela de início
          (Compartilhar → Adicionar à Tela de Início) e abra por lá.
        </p>
      ) : (
        <p className="muted">
          Avisos de vencimentos, faturas e saldo negativo, mesmo com o app fechado.
          {state === 'on' ? ' Ligadas neste aparelho.' : ''}
        </p>
      )}
      {Boolean(error) && (
        <p className="alert alert--error" role="alert">
          {errorText(error)}
        </p>
      )}
      {state !== 'unsupported' && (
        <div className="form-actions">
          {state === 'on' && (
            <button
              type="button"
              className="btn"
              disabled={test.isPending}
              onClick={() => test.mutate()}
            >
              Enviar teste
            </button>
          )}
          <button
            type="button"
            className={state === 'on' ? 'btn' : 'btn btn--primary'}
            disabled={state === 'loading' || toggle.isPending}
            onClick={() => toggle.mutate()}
          >
            {state === 'on' ? (
              <BellOff size={18} aria-hidden="true" />
            ) : (
              <Bell size={18} aria-hidden="true" />
            )}
            {state === 'on' ? 'Desligar' : 'Ligar notificações'}
          </button>
        </div>
      )}
    </section>
  );
}

function AlertSettings() {
  const qc = useQueryClient();
  const toast = useToast();
  const settings = useQuery({
    queryKey: KEY,
    queryFn: () => api<NotificationSettings>('/api/notification-settings'),
  });
  const save = useMutation({
    mutationFn: (body: Partial<NotificationSettings>) =>
      api<NotificationSettings>('/api/notification-settings', { method: 'PATCH', body }),
    onSuccess: (data) => qc.setQueryData(KEY, data),
    onError: (err) => toast({ text: errorText(err) }),
  });
  if (settings.isPending) return <div className="skeleton" style={{ height: 300 }} />;
  if (!settings.data) return null;
  const s = settings.data;
  return (
    <section className="card card--pad form" aria-labelledby="alerts-title">
      <h2 id="alerts-title">Quais avisos receber</h2>
      <ul className="list settings-list">
        {s.types
          .filter((t) => !['split_pending'].includes(t.type))
          .map((t) => {
            const meta = TYPE_LABEL[t.type];
            return (
              <li key={t.type} className="settings-row">
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={t.enabled}
                    onChange={(e) => save.mutate({ types: [{ ...t, enabled: e.target.checked }] })}
                  />
                  <span>
                    <strong>{meta.label}</strong>
                  </span>
                </label>
                {meta.days && t.enabled && (
                  <label className="settings-days">
                    <span className="muted">Avisar</span>
                    <select
                      className="input"
                      value={t.daysBefore}
                      onChange={(e) =>
                        save.mutate({ types: [{ ...t, daysBefore: Number(e.target.value) }] })
                      }
                    >
                      {[0, 1, 2, 3, 5, 7].map((n) => (
                        <option key={n} value={n}>
                          {n === 0 ? 'só no dia' : `${n} dia${n > 1 ? 's' : ''} antes`}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </li>
            );
          })}
      </ul>
      <fieldset className="fieldset">
        <legend className="field-label">Horário de silêncio</legend>
        <div className="field-row">
          <div className="field">
            <label htmlFor="quiet-start">De</label>
            <input
              id="quiet-start"
              type="time"
              className="input"
              value={s.quietStart ?? ''}
              onChange={(e) => save.mutate({ quietStart: e.target.value || null })}
            />
          </div>
          <div className="field">
            <label htmlFor="quiet-end">Até</label>
            <input
              id="quiet-end"
              type="time"
              className="input"
              value={s.quietEnd ?? ''}
              onChange={(e) => save.mutate({ quietEnd: e.target.value || null })}
            />
          </div>
        </div>
        <span className="muted field-hint">Nesse horário os avisos esperam e chegam depois.</span>
      </fieldset>
    </section>
  );
}

export function SettingsPage() {
  return (
    <>
      <PageHeader title="Configurações" back="/mais" />
      <PushCard />
      <AlertSettings />
    </>
  );
}
