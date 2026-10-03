import { useState, type ChangeEvent } from 'react';

interface BaseProps {
  id?: string;
  className?: string;
  disabled?: boolean;
  'aria-label'?: string;
  'aria-describedby'?: string;
}

/**
 * Número inteiro digitado à mão (parcelas, cotas...). Sem as setinhas do `type="number"`
 * (que não existem no celular): teclado numérico, apagar tudo e digitar de novo funciona
 * (ex.: 21), e ao tocar o campo o valor fica selecionado. O valor só é aceito dentro de
 * `min`..`max`; ao sair do campo, mostra o último valor válido.
 */
export function IntegerInput({
  value,
  onChange,
  min = 0,
  max = 9999,
  emptyWhenZero = false,
  className = 'input num',
  ...rest
}: BaseProps & {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  /** Mostra o campo vazio quando o valor é 0 (campo opcional). */
  emptyWhenZero?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (emptyWhenZero && value === 0 ? '' : String(value));

  const change = (e: ChangeEvent<HTMLInputElement>) => {
    const digits = e.target.value.replace(/\D/g, '').slice(0, String(max).length);
    setDraft(digits);
    if (digits === '') {
      if (emptyWhenZero && min <= 0) onChange(0);
      return;
    }
    const typed = Number(digits);
    const n = Math.min(max, typed);
    if (n !== typed) setDraft(String(n));
    if (n >= min) onChange(n);
  };

  return (
    <input
      {...rest}
      className={className}
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      autoComplete="off"
      value={shown}
      onFocus={(e) => {
        setDraft(shown);
        e.currentTarget.select();
      }}
      onChange={change}
      onBlur={() => setDraft(null)}
    />
  );
}

/**
 * Número com casas decimais (percentuais): aceita vírgula ou ponto e tem teclado decimal.
 * Apagar e redigitar funciona; só valores de `min` a `max` são aceitos.
 */
export function DecimalInput({
  value,
  onChange,
  min = 0,
  max = 100,
  className = 'input num',
  ...rest
}: BaseProps & {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? String(value).replace('.', ',');

  return (
    <input
      {...rest}
      className={className}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      value={shown}
      onFocus={(e) => {
        setDraft(shown);
        e.currentTarget.select();
      }}
      onChange={(e) => {
        const text = e.target.value.replace(/[^\d.,]/g, '');
        setDraft(text);
        const n = Number(text.replace(',', '.'));
        if (text !== '' && Number.isFinite(n) && n >= min && n <= max) onChange(n);
      }}
      onBlur={() => setDraft(null)}
    />
  );
}
