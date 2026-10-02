/**
 * Núcleo de regras financeiras: apenas funções puras, sem I/O.
 * Os módulos (money, dates, recurrence, cards...) entram na Fase 1.
 * @see docs/regras-de-negocio.md
 */

/** Verifica se um valor é uma quantia válida em centavos (inteiro seguro). */
export function isCents(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}
