const MAX_DIGITS = 13; // até R$ 99.999.999.999,99

/**
 * Centavos depois de uma digitação no campo de valor (dígitos entram pela direita).
 * `fresh`: primeira tecla depois de focar um valor sugerido, que é substituído pelo
 * que foi digitado em vez de receber os dígitos no fim.
 */
export function typedCents(previous: number, raw: string, fresh: boolean): number {
  const old = String(Math.abs(previous));
  let digits = raw.replace(/\D/g, '').replace(/^0+/, '');
  if (fresh && digits.length > old.length && digits.startsWith(old)) {
    digits = digits.slice(old.length);
  }
  digits = digits.slice(0, MAX_DIGITS);
  return digits ? Number(digits) : 0;
}
