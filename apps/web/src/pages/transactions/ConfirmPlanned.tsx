import type { Transaction } from '@finapp/shared';
import { useState } from 'react';
import { MoneyInput } from '../../components/MoneyInput';
import { useToast } from '../../components/Toast';
import { money } from '../../lib/format';
import { useSettleTransaction } from '../../lib/queries';
import { errorText } from './EntryForm';

/**
 * "Confirmar" de um previsto. Valor estimado (conta variável): pede o valor real antes.
 * @see RN 3 (Valor variável)
 */
export function ConfirmPlanned({ t }: { t: Transaction }) {
  const settle = useSettleTransaction();
  const toast = useToast();
  const [asking, setAsking] = useState(false);
  const [amount, setAmount] = useState(t.amount);

  const confirm = (real?: number) =>
    settle.mutate(
      { id: t.id, ...(real !== undefined ? { amount: real } : {}) },
      {
        onSuccess: () => {
          setAsking(false);
          toast({
            text:
              real !== undefined && real !== t.amount
                ? `"${t.description}" confirmado com ${money(real)}.`
                : `"${t.description}" confirmado.`,
          });
        },
        onError: (err) => toast({ text: errorText(err) }),
      },
    );

  if (!t.estimated) {
    return (
      <button
        type="button"
        className="btn tx__confirm"
        disabled={settle.isPending}
        onClick={() => confirm()}
      >
        Confirmar
      </button>
    );
  }

  if (!asking) {
    return (
      <button type="button" className="btn tx__confirm" onClick={() => setAsking(true)}>
        Informar valor real
      </button>
    );
  }

  return (
    <form
      className="tx__real"
      onSubmit={(e) => {
        e.preventDefault();
        if (amount > 0) confirm(amount);
      }}
    >
      <label htmlFor={`real-${t.id}`} className="muted">
        Valor real (estimado: {money(t.amount)})
      </label>
      <MoneyInput id={`real-${t.id}`} value={amount} onChange={setAmount} autoFocus replaceOnType />
      <div className="form-actions">
        <button type="button" className="btn" onClick={() => setAsking(false)}>
          Cancelar
        </button>
        <button
          type="submit"
          className="btn btn--primary"
          disabled={settle.isPending || amount <= 0}
        >
          Confirmar {money(amount)}
        </button>
      </div>
    </form>
  );
}
