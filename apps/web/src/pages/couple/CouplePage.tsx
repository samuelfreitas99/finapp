import { ArrowRight, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { useActiveSpace, useMe } from '../../auth/session';
import { PageHeader } from '../../components/PageHeader';
import { useToast } from '../../components/Toast';
import { formatDate, money } from '../../lib/format';
import { useHiddenValues } from '../../lib/hidden-values';
import {
  useCoupleBalance,
  useCoupleMutations,
  useSpaceMembers,
  useSplitSettings,
} from '../../lib/queries';
import { errorText } from '../transactions/EntryForm';
import { DecimalInput } from '../../components/NumberInputs';

function Settings({ spaceId, isOwner }: { spaceId: string; isOwner: boolean }) {
  const toast = useToast();
  const settings = useSplitSettings();
  const members = useSpaceMembers(spaceId);
  const { saveSettings } = useCoupleMutations();
  const [mode, setMode] = useState<'equal' | 'percent' | 'none' | null>(null);
  const [percents, setPercents] = useState<Record<string, number> | null>(null);
  if (!settings.data || !members.data) return null;
  const currentMode = mode ?? settings.data.mode;
  const current = percents ?? settings.data.percents;
  const total = members.data.reduce((s, m) => s + Math.round((current[m.userId] ?? 0) * 100), 0);

  return (
    <section className="card card--pad form" aria-labelledby="cp-default">
      <h2 id="cp-default">Divisão padrão</h2>
      <p className="muted">
        Sugestão ao dividir uma despesa. {isOwner ? '' : 'Só o dono do espaço altera.'}
      </p>
      {saveSettings.isError && (
        <p className="alert alert--error" role="alert">
          {errorText(saveSettings.error)}
        </p>
      )}
      <div className="segmented" role="group" aria-label="Padrão">
        {(
          [
            ['equal', 'Igualmente'],
            ['percent', 'Por percentual'],
            ['none', 'Sem divisão'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            disabled={!isOwner}
            aria-pressed={currentMode === value}
            onClick={() => setMode(value)}
          >
            {label}
          </button>
        ))}
      </div>
      {currentMode === 'percent' &&
        members.data.map((m) => (
          <div className="field" key={m.userId}>
            <label htmlFor={`def-${m.userId}`}>{m.name} (%)</label>
            <DecimalInput
              id={`def-${m.userId}`}
              disabled={!isOwner}
              value={current[m.userId] ?? 0}
              onChange={(v) => setPercents({ ...current, [m.userId]: v })}
            />
          </div>
        ))}
      {currentMode === 'percent' && total !== 10000 && (
        <p className="muted expense" role="alert">
          Os percentuais somam {total / 100}%. Precisam somar 100%.
        </p>
      )}
      {isOwner && (
        <button
          type="button"
          className="btn"
          disabled={saveSettings.isPending || (currentMode === 'percent' && total !== 10000)}
          onClick={() =>
            saveSettings.mutate(
              { mode: currentMode, ...(currentMode === 'percent' ? { percents: current } : {}) },
              { onSuccess: () => toast({ text: 'Padrão salvo.' }) },
            )
          }
        >
          Salvar padrão
        </button>
      )}
    </section>
  );
}

/** Saldo entre os membros do espaço compartilhado e acertos. @see RN 10 */
export function CouplePage() {
  const toast = useToast();
  const { hidden } = useHiddenValues();
  const { data: me } = useMe();
  const space = useActiveSpace();
  const shared = space?.type === 'shared';
  const balance = useCoupleBalance(shared);
  const { settle, undoSettlement } = useCoupleMutations();
  const error = balance.error ?? settle.error ?? undoSettlement.error;
  const nameOf = (id: string) => {
    const m = balance.data?.members.find((x) => x.userId === id);
    return id === me?.user.id ? 'Você' : (m?.name ?? 'Alguém');
  };

  if (!shared) {
    return (
      <>
        <PageHeader title="Divisão do espaço" back="/mais" />
        <section className="card empty">
          <h2>Só para espaços compartilhados</h2>
          <p className="muted">
            Crie um espaço compartilhado ou troque para ele no topo da tela para dividir despesas.
          </p>
          <Link to="/espacos" className="btn btn--primary">
            Espaços e membros
          </Link>
        </section>
      </>
    );
  }

  const data = balance.data;
  return (
    <>
      <PageHeader title="Divisão do espaço" back="/mais" />
      {error && (
        <p className="alert alert--error" role="alert">
          {errorText(error)}
        </p>
      )}
      {balance.isPending && <div className="skeleton" style={{ height: 160 }} />}
      {data && (
        <>
          <section className="card card--pad stack" aria-labelledby="cp-balance">
            <h2 id="cp-balance">Quem deve a quem</h2>
            {data.transfers.length === 0 ? (
              <p className="muted">Tudo certo: ninguém deve nada a ninguém.</p>
            ) : (
              <ul className="list">
                {data.transfers.map((t) => (
                  <li key={`${t.fromUserId}-${t.toUserId}`} className="row-link">
                    <span className="row-link__main">
                      <strong>
                        {nameOf(t.fromUserId)} <ArrowRight size={14} aria-hidden="true" />{' '}
                        {nameOf(t.toUserId)}
                      </strong>
                      <span className="num">{money(t.amount, hidden)}</span>
                    </span>
                    <button
                      type="button"
                      className="btn"
                      disabled={settle.isPending}
                      onClick={() =>
                        settle.mutate(
                          { fromUserId: t.fromUserId, toUserId: t.toUserId, amount: t.amount },
                          { onSuccess: () => toast({ text: 'Acerto registrado.' }) },
                        )
                      }
                    >
                      Registrar pagamento
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <dl className="invoice-head__rows">
              {data.members.map((m) => (
                <div key={m.userId}>
                  <dt>{nameOf(m.userId)}</dt>
                  <dd
                    className={`num ${m.balance < 0 ? 'expense' : m.balance > 0 ? 'income' : ''}`}
                  >
                    {m.balance > 0 ? 'tem a receber ' : m.balance < 0 ? 'deve ' : ''}
                    {money(Math.abs(m.balance), hidden)}
                  </dd>
                </div>
              ))}
            </dl>
            {data.staleCount > 0 && (
              <p className="alert alert--error" role="alert">
                {data.staleCount === 1
                  ? '1 despesa teve o valor alterado depois de dividida.'
                  : `${data.staleCount} despesas tiveram o valor alterado depois de divididas.`}{' '}
                Abra e salve a divisão de novo.
              </p>
            )}
            <p className="muted">
              Conta só despesas já pagas que você dividiu (em Lançamentos, abra a despesa e use
              &quot;Dividir com o espaço&quot;).
            </p>
          </section>

          {data.settlements.length > 0 && (
            <section className="card card--pad stack" aria-labelledby="cp-history">
              <h2 id="cp-history">Acertos feitos</h2>
              <ul className="list">
                {data.settlements.map((s) => (
                  <li key={s.id} className="row-link">
                    <span className="row-link__main">
                      <strong>
                        {nameOf(s.fromUserId)} pagou {nameOf(s.toUserId)}
                      </strong>
                      <span className="muted">
                        {formatDate(s.date)}
                        {s.notes ? ` · ${s.notes}` : ''}
                      </span>
                    </span>
                    <span className="num">{money(s.amount, hidden)}</span>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label="Desfazer acerto"
                      onClick={() => undoSettlement.mutate(s.id)}
                    >
                      <Undo2 size={18} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <Settings spaceId={space.id} isOwner={space.role === 'owner'} />
        </>
      )}
    </>
  );
}
