import type { Cents } from '../money';

/**
 * Exportação: serialização de CSV (padrão Excel brasileiro) e valores em reais.
 */

/** Centavos em reais com vírgula decimal e sem milhar: 123456 → "1234,56". */
export function centsToDecimal(cents: Cents): string {
  const abs = Math.abs(cents);
  const text = `${Math.floor(abs / 100)},${String(abs % 100).padStart(2, '0')}`;
  return cents < 0 ? `-${text}` : text;
}

/**
 * Célula de CSV com aspas quando preciso. Texto que começa com `=`, `+`, `-`, `@` ou tab
 * ganha um apóstrofo na frente, para o Excel não executar como fórmula.
 */
export function csvCell(
  value: string | number | boolean | null | undefined,
  delimiter = ';',
): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /["\n\r]/.test(text) || text.includes(delimiter) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** CSV com ponto e vírgula e BOM (abre direto no Excel em português). */
export function toCSV(
  headers: readonly string[],
  rows: readonly (readonly (string | number | boolean | null | undefined)[])[],
  delimiter = ';',
): string {
  const lines = [headers, ...rows].map((r) => r.map((c) => csvCell(c, delimiter)).join(delimiter));
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
