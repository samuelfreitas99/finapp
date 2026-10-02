import { formatBRL } from '@finapp/core';
import { typedCents } from '../lib/money-input';
import { Minus, Plus } from 'lucide-react';
import { useRef, type ChangeEvent } from 'react';

interface Props {
  id: string;
  value: number;
  onChange: (cents: number) => void;
  /** Mostra o botão de sinal (ex.: saldo inicial negativo). */
  allowNegative?: boolean;
  large?: boolean;
  autoFocus?: boolean;
  /**
   * Valor já preenchido (estimativa, total a pagar): o primeiro dígito digitado depois de
   * focar começa um valor novo, em vez de se juntar ao que estava.
   */
  replaceOnType?: boolean;
  'aria-describedby'?: string;
}

/**
 * Valor em reais digitado como no app do banco: os dígitos entram pela direita
 * ("1", "12", "1234" → R$ 12,34). Guarda centavos inteiros, sem float.
 */
export function MoneyInput({
  id,
  value,
  onChange,
  allowNegative = false,
  large = false,
  autoFocus,
  replaceOnType = false,
  ...rest
}: Props) {
  const fresh = useRef(replaceOnType);
  const negative = value < 0;
  const shown = formatBRL(Math.abs(value));

  const handle = (e: ChangeEvent<HTMLInputElement>) => {
    const cents = typedCents(value, e.target.value, fresh.current);
    fresh.current = false;
    onChange(negative ? -cents : cents);
  };

  return (
    <div className={large ? 'money money--large' : 'money'}>
      {allowNegative && (
        <button
          type="button"
          className="money__sign"
          aria-pressed={negative}
          aria-label={
            negative
              ? 'Valor negativo (tocar para positivo)'
              : 'Valor positivo (tocar para negativo)'
          }
          onClick={() => onChange(-value)}
        >
          {negative ? (
            <Minus size={18} aria-hidden="true" />
          ) : (
            <Plus size={18} aria-hidden="true" />
          )}
        </button>
      )}
      <input
        id={id}
        className="money__input num"
        inputMode="numeric"
        autoComplete="off"
        autoFocus={autoFocus}
        value={negative ? `−${shown}` : shown}
        onChange={handle}
        // O cursor fica sempre no fim: os dígitos entram pela direita, onde quer que se toque.
        onFocus={() => {
          if (replaceOnType) fresh.current = true;
        }}
        onSelect={(e) => {
          const el = e.currentTarget;
          const end = el.value.length;
          if (el.selectionStart !== end || el.selectionEnd !== end) el.setSelectionRange(end, end);
        }}
        aria-describedby={rest['aria-describedby']}
      />
    </div>
  );
}
