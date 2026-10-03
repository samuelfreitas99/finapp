import type { GroupDetail, RachaMode } from '@finapp/shared';
import { ArrowRight, Copy, Trash2, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { useParams } from 'react-router';
import { MoneyInput } from '../../components/MoneyInput';
import { PageHeader } from '../../components/PageHeader';
import { useToast } from '../../components/Toast';
import { today } from '../../lib/dates';
import { formatDate, money } from '../../lib/format';
import { useHiddenValues } from '../../lib/hidden-values';
import { useGroup, useRachaMutations } from '../../lib/queries';
import { errorText } from '../transactions/EntryForm';

const MODE_LABEL: Record<RachaMode, string> = {
  equal: 'Igualmente',
  percent: 'Por percentual',
  amount: 'Por valor',
  shares: 'Por cotas',
};

function ExpenseForm({ group, onDone }: { group: GroupDetail; onDone: () => void }) {
  const toast = useToast();
  const { saveExpense } = useRachaMutations(group.id);
  const me = group.participants.find((p) => p.isMe)?.id ?? group.participants[0]?.id ?? '';
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState(0);
  const [date, setDate] = useState(today());
  const [payer, setPayer] = useState(me);
  const [mode, setMode] = useState<RachaMode>('equal');
  const [included, setIncluded] = useState<Record<string, boolean>>(
    Object.fromEntries(group.participants.map((p) => [p.id, true])),
  );
  const [values, setValues] = useState<Record<string, number>>({});
  const people = group.participants.filter((p) => included[p.id]);
  const total = people.reduce((s, p) => s + (values[p.id] ?? 0), 0);
  const invalid =
    !description.trim() ||
    amount <= 0 ||
    people.length === 0 ||
    (mode === 'percent' && Math.round(total * 100) !== 10000) ||
    (mode === 'amount' && total !== amount) ||
    (mode === 'shares' && people.some((p) => (values[p.id] ?? 1) < 1));

  const submit = () =>
    saveExpense.mutate(
      {
        description: description.trim(),
        amount,
        date,
        mode,
        payers: [{ participantId: payer, amount }],
        shares: people.map((p) => ({
          participantId: p.id,
          ...(mode === 'percent' ? { percent: values[p.id] ?? 0 } : {}),
          ...(mode === 'amount' ? { amount: values[p.id] ?? 0 } : {}),
          ...(mode === 'shares' ? { weight: values[p.id] ?? 1 } : {}),
        })),
      },
      {
        onSuccess: () => {
          toast({ text: 'Despesa adicionada.' });
          onDone();
        },
      },
    );

  return (
    <form
      className="card card--pad form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!invalid) submit();
      }}
    >
      <h2>Nova despesa</h2>
      {saveExpense.isError && (
        <p className="alert alert--error" role="alert">
          {errorText(saveExpense.error)}
        </p>
      )}
      <div className="field">
        <label htmlFor="ex-desc">O que foi</label>
        <input
          id="ex-desc"
          className="input"
          maxLength={200}
          placeholder="Ex.: Jantar, Airbnb"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="ex-amount">Valor</label>
        <MoneyInput id="ex-amount" large value={amount} onChange={setAmount} />
      </div>
      <div className="field-row">
        <div className="field">
          <label htmlFor="ex-date">Data</label>
          <input
            id="ex-date"
            type="date"
            className="input"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="ex-payer">Quem pagou</label>
          <select
            id="ex-payer"
            className="input"
            value={payer}
            onChange={(e) => setPayer(e.target.value)}
          >
            {group.participants.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.isMe ? ' (você)' : ''}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="segmented" role="group" aria-label="Como dividir">
        {(Object.keys(MODE_LABEL) as RachaMode[]).map((m) => (
          <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)}>
            {MODE_LABEL[m]}
          </button>
        ))}
      </div>
      <fieldset className="stack">
        <legend>Quem divide</legend>
        {group.participants.map((p) => (
          <div key={p.id} className="field-row">
            <label className="toggle">
              <input
                type="checkbox"
                checked={included[p.id] ?? false}
                onChange={(e) => setIncluded({ ...included, [p.id]: e.target.checked })}
              />
              <span>
                {p.name}
                {p.isMe ? ' (você)' : ''}
              </span>
            </label>
            {included[p.id] && mode === 'percent' && (
              <input
                className="input"
                type="number"
                min={0}
                max={100}
                step="0.01"
                aria-label={`Percentual de ${p.name}`}
                value={values[p.id] ?? 0}
                onChange={(e) => setValues({ ...values, [p.id]: Number(e.target.value) })}
              />
            )}
            {included[p.id] && mode === 'shares' && (
              <input
                className="input"
                type="number"
                min={1}
                step={1}
                aria-label={`Cotas de ${p.name}`}
                value={values[p.id] ?? 1}
                onChange={(e) => setValues({ ...values, [p.id]: Number(e.target.value) })}
              />
            )}
            {included[p.id] && mode === 'amount' && (
              <MoneyInput
                id={`ex-v-${p.id}`}
                value={values[p.id] ?? 0}
                onChange={(v) => setValues({ ...values, [p.id]: v })}
              />
            )}
          </div>
        ))}
      </fieldset>
      {mode === 'percent' && Math.round(total * 100) !== 10000 && (
        <p className="muted expense" role="alert">
          Os percentuais somam {total}%. Precisam somar 100%.
        </p>
      )}
      {mode === 'amount' && total !== amount && (
        <p className="muted expense" role="alert">
          As partes somam {money(total)}; a despesa é {money(amount)}.
        </p>
      )}
      <div className="form__actions">
        <button type="button" className="btn" onClick={onDone}>
          Cancelar
        </button>
        <button
          type="submit"
          className="btn btn--primary"
          disabled={invalid || saveExpense.isPending}
        >
          Adicionar
        </button>
      </div>
    </form>
  );
}

/** Um grupo de racha: saldos, despesas, acertos e participantes. @see RN 11 */
export function GroupPage() {
  const { id = '' } = useParams();
  const toast = useToast();
  const { hidden } = useHiddenValues();
  const group = useGroup(id);
  const m = useRachaMutations(id);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const error =
    group.error ??
    m.removeExpense.error ??
    m.settle.error ??
    m.undoSettlement.error ??
    m.addParticipant.error ??
    m.removeParticipant.error ??
    m.update.error;

  if (group.isPending) return <div className="skeleton" style={{ height: 240 }} />;
  if (group.isError || !group.data) {
    return (
      <>
        <PageHeader title="Grupo" back="/racha" />
        <p className="alert alert--error" role="alert">
          {errorText(error)}
        </p>
      </>
    );
  }
  const g = group.data;
  const name = (pid: string) => {
    const p = g.participants.find((x) => x.id === pid);
    return p?.isMe ? 'Você' : (p?.name ?? '?');
  };

  return (
    <>
      <PageHeader
        title={g.name}
        back="/racha"
        action={
          !g.archived && !adding ? (
            <button type="button" className="btn btn--primary" onClick={() => setAdding(true)}>
              Despesa
            </button>
          ) : undefined
        }
      />
      {error && (
        <p className="alert alert--error" role="alert">
          {errorText(error)}
        </p>
      )}
      {g.archived && <p className="alert">Grupo arquivado: só consulta.</p>}
      {adding && <ExpenseForm group={g} onDone={() => setAdding(false)} />}

      <section className="card card--pad stack" aria-labelledby="g-bal">
        <h2 id="g-bal">Quem deve a quem</h2>
        {g.balances.transfers.length === 0 ? (
          <p className="muted">Tudo certo: ninguém deve nada a ninguém.</p>
        ) : (
          <ul className="list">
            {g.balances.transfers.map((t) => (
              <li key={`${t.fromParticipantId}-${t.toParticipantId}`} className="row-link">
                <span className="row-link__main">
                  <strong>
                    {name(t.fromParticipantId)} <ArrowRight size={14} aria-hidden="true" />{' '}
                    {name(t.toParticipantId)}
                  </strong>
                  <span className="num">{money(t.amount, hidden)}</span>
                </span>
                {!g.archived && (
                  <button
                    type="button"
                    className="btn"
                    disabled={m.settle.isPending}
                    onClick={() =>
                      m.settle.mutate(
                        { ...t, method: 'Pix' },
                        { onSuccess: () => toast({ text: 'Acerto registrado.' }) },
                      )
                    }
                  >
                    Registrar pagamento
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        <dl className="invoice-head__rows">
          {g.balances.balances.map((b) => (
            <div key={b.participantId}>
              <dt>{name(b.participantId)}</dt>
              <dd className={`num ${b.balance < 0 ? 'expense' : b.balance > 0 ? 'income' : ''}`}>
                {b.balance > 0 ? 'tem a receber ' : b.balance < 0 ? 'deve ' : 'em dia '}
                {b.balance === 0 ? '' : money(Math.abs(b.balance), hidden)}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="card card--pad stack" aria-labelledby="g-exp">
        <h2 id="g-exp">Despesas</h2>
        {g.expenses.length === 0 && <p className="muted">Nenhuma despesa ainda.</p>}
        <ul className="list">
          {g.expenses.map((e) => (
            <li key={e.id} className="row-link">
              <span className="row-link__main">
                <strong>{e.description}</strong>
                <span className="muted">
                  {formatDate(e.date)} · pago por{' '}
                  {e.payers.map((p) => name(p.participantId)).join(', ')} ·{' '}
                  {MODE_LABEL[e.mode].toLowerCase()} entre {e.shares.length}
                </span>
              </span>
              <span className="num">{money(e.amount, hidden)}</span>
              {!g.archived && (
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`Excluir ${e.description}`}
                  onClick={() => {
                    if (window.confirm(`Excluir ${e.description}?`)) m.removeExpense.mutate(e.id);
                  }}
                >
                  <Trash2 size={18} aria-hidden="true" />
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      {g.settlements.length > 0 && (
        <section className="card card--pad stack" aria-labelledby="g-set">
          <h2 id="g-set">Acertos feitos</h2>
          <ul className="list">
            {g.settlements.map((s) => (
              <li key={s.id} className="row-link">
                <span className="row-link__main">
                  <strong>
                    {name(s.fromParticipantId)} pagou {name(s.toParticipantId)}
                  </strong>
                  <span className="muted">
                    {formatDate(s.date)}
                    {s.method ? ` · ${s.method}` : ''}
                  </span>
                </span>
                <span className="num">{money(s.amount, hidden)}</span>
                {!g.archived && (
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label="Desfazer acerto"
                    onClick={() => m.undoSettlement.mutate(s.id)}
                  >
                    <Undo2 size={18} aria-hidden="true" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card card--pad stack" aria-labelledby="g-people">
        <h2 id="g-people">Participantes</h2>
        <ul className="list">
          {g.participants.map((p) => (
            <li key={p.id} className="row-link">
              <span className="row-link__main">
                <strong>
                  {p.name}
                  {p.isMe ? ' (você)' : ''}
                </strong>
                <span className="muted">{p.userId ? 'Tem o app' : 'Sem conta'}</span>
              </span>
              {!p.isMe && !g.archived && (
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`Remover ${p.name}`}
                  onClick={() => m.removeParticipant.mutate(p.id)}
                >
                  <Trash2 size={18} aria-hidden="true" />
                </button>
              )}
            </li>
          ))}
        </ul>
        {!g.archived && (
          <form
            className="form"
            onSubmit={(e) => {
              e.preventDefault();
              m.addParticipant.mutate(newName.trim(), { onSuccess: () => setNewName('') });
            }}
          >
            <div className="field">
              <label htmlFor="g-add">Adicionar amigo (sem conta)</label>
              <input
                id="g-add"
                className="input"
                maxLength={120}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </div>
            <button
              type="submit"
              className="btn"
              disabled={!newName.trim() || m.addParticipant.isPending}
            >
              Adicionar
            </button>
          </form>
        )}
        <p className="muted">
          Código para amigos com conta entrarem: <strong className="num">{g.joinCode}</strong>{' '}
          <button
            type="button"
            className="icon-btn"
            aria-label="Copiar código"
            onClick={() => {
              void navigator.clipboard?.writeText(g.joinCode);
              toast({ text: 'Código copiado.' });
            }}
          >
            <Copy size={16} aria-hidden="true" />
          </button>
        </p>
        <button
          type="button"
          className="btn"
          onClick={() =>
            m.update.mutate(
              { archived: !g.archived },
              {
                onSuccess: () =>
                  toast({ text: g.archived ? 'Grupo reaberto.' : 'Grupo arquivado.' }),
              },
            )
          }
        >
          {g.archived ? 'Reabrir grupo' : 'Arquivar grupo'}
        </button>
      </section>
    </>
  );
}
