import type { CoupleSplit as CoupleSplitDto, CoupleSplitMode, SpaceMember } from '@finapp/shared';
import { useState } from 'react';
import { useActiveSpace, useMe } from '../../auth/session';
import { MoneyInput } from '../../components/MoneyInput';
import { useToast } from '../../components/Toast';
import { money } from '../../lib/format';
import {
  useCoupleMutations,
  useSpaceMembers,
  useSplitSettings,
  useTransactionSplit,
} from '../../lib/queries';
import { errorText } from './EntryForm';

const MODES: { value: CoupleSplitMode; label: string }[] = [
  { value: 'none', label: 'Não dividir' },
  { value: 'equal', label: 'Igualmente' },
  { value: 'percent', label: 'Por percentual' },
  { value: 'amount', label: 'Por valor' },
];

/**
 * Divisão de uma despesa entre os membros do espaço compartilhado. Quem pagou com dinheiro
 * próprio vira credor dos outros (saldo em "Divisão do casal").
 */
export function CoupleSplit({ transactionId, amount }: { transactionId: string; amount: number }) {
  const space = useActiveSpace();
  const shared = space?.type === 'shared';
  const members = useSpaceMembers(space?.id ?? '', shared);
  const current = useTransactionSplit(transactionId, shared);
  const defaults = useSplitSettings(shared);
  if (!shared) return null;
  if (!members.data || !current.data || !defaults.data) {
    return <div className="skeleton" style={{ height: 120 }} />;
  }
  return (
    <CoupleSplitForm
      transactionId={transactionId}
      amount={amount}
      members={members.data}
      current={current.data}
      defaultPercents={defaults.data.percents}
    />
  );
}

function CoupleSplitForm({
  transactionId,
  amount,
  members: list,
  current: currentSplit,
  defaultPercents,
}: {
  transactionId: string;
  amount: number;
  members: SpaceMember[];
  current: CoupleSplitDto;
  defaultPercents: Record<string, number>;
}) {
  const toast = useToast();
  const { data: me } = useMe();
  const { saveSplit } = useCoupleMutations();
  const existing = currentSplit.shares.length > 0;
  const [mode, setMode] = useState<CoupleSplitMode>(existing ? 'amount' : 'none');
  const [paidBy, setPaidBy] = useState(
    existing ? (currentSplit.paidByUserId ?? '') : (me?.user.id ?? ''),
  );
  const [percents, setPercents] = useState<Record<string, number>>(defaultPercents);
  const [amounts, setAmounts] = useState<Record<string, number>>(
    Object.fromEntries(currentSplit.shares.map((x) => [x.userId, x.amount])),
  );
  const current = { data: currentSplit };

  const pctTotal = list.reduce((s, m) => s + Math.round((percents[m.userId] ?? 0) * 100), 0);
  const amtTotal = list.reduce((s, m) => s + (amounts[m.userId] ?? 0), 0);
  const invalid =
    (mode === 'percent' && pctTotal !== 10000) || (mode === 'amount' && amtTotal !== amount);

  return (
    <section className="card card--pad form" aria-labelledby="couple-split">
      <h2 id="couple-split">Dividir com o espaço</h2>
      <p className="muted">
        Se alguém pagou com dinheiro próprio, a divisão cria um saldo entre vocês.
      </p>
      {current.data &&
        current.data.shares.length > 0 &&
        current.data.shares.reduce((s, x) => s + x.amount, 0) !== amount && (
          <p className="alert alert--error" role="alert">
            O valor mudou depois da divisão. Salve de novo para atualizar.
          </p>
        )}
      {saveSplit.isError && (
        <p className="alert alert--error" role="alert">
          {errorText(saveSplit.error)}
        </p>
      )}
      <div className="segmented" role="group" aria-label="Como dividir">
        {MODES.map((m) => (
          <button
            key={m.value}
            type="button"
            aria-pressed={mode === m.value}
            onClick={() => {
              setMode(m.value);
              if (m.value === 'amount' && Object.keys(amounts).length === 0 && list.length > 0) {
                const each = Math.floor(amount / list.length);
                setAmounts(
                  Object.fromEntries(
                    list.map((x, i) => [
                      x.userId,
                      i === 0 ? amount - each * (list.length - 1) : each,
                    ]),
                  ),
                );
              }
            }}
          >
            {m.label}
          </button>
        ))}
      </div>
      {mode !== 'none' && (
        <>
          <div className="field">
            <label htmlFor="cs-paid">Quem pagou</label>
            <select
              id="cs-paid"
              className="input"
              value={paidBy}
              onChange={(e) => setPaidBy(e.target.value)}
            >
              {list.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name}
                  {m.userId === me?.user.id ? ' (você)' : ''}
                </option>
              ))}
            </select>
          </div>
          {mode === 'percent' &&
            list.map((m) => (
              <div className="field" key={m.userId}>
                <label htmlFor={`cs-p-${m.userId}`}>{m.name} (%)</label>
                <input
                  id={`cs-p-${m.userId}`}
                  className="input"
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  value={percents[m.userId] ?? 0}
                  onChange={(e) => setPercents({ ...percents, [m.userId]: Number(e.target.value) })}
                />
              </div>
            ))}
          {mode === 'percent' && pctTotal !== 10000 && (
            <p className="muted expense" role="alert">
              Os percentuais somam {pctTotal / 100}%. Precisam somar 100%.
            </p>
          )}
          {mode === 'amount' &&
            list.map((m) => (
              <div className="field" key={m.userId}>
                <label htmlFor={`cs-a-${m.userId}`}>Parte de {m.name}</label>
                <MoneyInput
                  id={`cs-a-${m.userId}`}
                  value={amounts[m.userId] ?? 0}
                  onChange={(v) => setAmounts({ ...amounts, [m.userId]: v })}
                />
              </div>
            ))}
          {mode === 'amount' && amtTotal !== amount && (
            <p className="muted expense" role="alert">
              As partes somam {money(amtTotal)}; a despesa é {money(amount)}.
            </p>
          )}
        </>
      )}
      <button
        type="button"
        className="btn btn--primary"
        disabled={invalid || saveSplit.isPending || (mode !== 'none' && !paidBy)}
        onClick={() =>
          saveSplit.mutate(
            {
              id: transactionId,
              mode,
              ...(mode === 'none' ? {} : { paidByUserId: paidBy }),
              ...(mode === 'percent'
                ? {
                    parts: list.map((m) => ({
                      userId: m.userId,
                      percent: percents[m.userId] ?? 0,
                    })),
                  }
                : mode === 'amount'
                  ? {
                      parts: list.map((m) => ({
                        userId: m.userId,
                        amount: amounts[m.userId] ?? 0,
                      })),
                    }
                  : {}),
            },
            {
              onSuccess: () =>
                toast({ text: mode === 'none' ? 'Divisão removida.' : 'Divisão salva.' }),
            },
          )
        }
      >
        Salvar divisão
      </button>
    </section>
  );
}
