/**
 * Dinheiro sempre em centavos inteiros (`number` inteiro seguro).
 * Formatação só na borda (UI).
 * @see RN 5.1
 */

/** Quantia em centavos (inteiro). */
export type Cents = number;

/** Verifica se um valor é uma quantia válida em centavos (inteiro seguro). */
export function isCents(value: unknown): value is Cents {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

/** Lança `RangeError` se o valor não for uma quantia válida em centavos. */
export function assertCents(value: unknown, label = 'valor'): asserts value is Cents {
  if (!isCents(value)) {
    throw new RangeError(`${label} deve ser um inteiro em centavos, recebido: ${String(value)}`);
  }
}

/** Soma quantias em centavos, garantindo que todas são inteiras. */
export function sumCents(values: Iterable<Cents>): Cents {
  let total = 0;
  for (const v of values) {
    assertCents(v);
    total += v;
  }
  assertCents(total, 'soma');
  return total;
}

/**
 * Divide um total em `n` partes inteiras. A **1ª parte** recebe o resto.
 * Ex.: 10000 em 3 → [3334, 3333, 3333].
 * Para totais negativos (estornos), divide o valor absoluto e reaplica o sinal,
 * para a 1ª parte continuar sendo a "maior" em módulo.
 * @see RN 5.1
 */
export function splitCents(total: Cents, n: number): Cents[] {
  assertCents(total, 'total');
  if (!Number.isSafeInteger(n) || n < 1) {
    throw new RangeError(`número de partes deve ser inteiro >= 1, recebido: ${n}`);
  }
  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);
  const base = Math.floor(abs / n);
  const remainder = abs - base * n;
  const parts = Array.from({ length: n }, (_, i) => (i === 0 ? base + remainder : base));
  return sign === 1 ? parts : parts.map((p) => (p === 0 ? 0 : -p));
}

/**
 * Total de um parcelamento quando o usuário informa o valor da parcela.
 * @see RN 5.1
 */
export function totalFromInstallment(installment: Cents, n: number): Cents {
  assertCents(installment, 'parcela');
  if (!Number.isSafeInteger(n) || n < 1) {
    throw new RangeError(`número de parcelas deve ser inteiro >= 1, recebido: ${n}`);
  }
  const total = installment * n;
  assertCents(total, 'total');
  return total;
}

/** Converte um número decimal (como digitado, ex.: 0.0199 ou 1e-7) em fração exata p/q. */
function decimalToRational(x: number): [bigint, bigint] {
  const [mantissa = '0', exponent = '0'] = String(x).split('e');
  const [intPart = '0', fracPart = ''] = mantissa.split('.');
  let numerator = BigInt(intPart + fracPart);
  let denominator = 10n ** BigInt(fracPart.length);
  const exp = Number(exponent);
  if (exp >= 0) numerator *= 10n ** BigInt(exp);
  else denominator *= 10n ** BigInt(-exp);
  return [numerator, denominator];
}

function floorDiv(a: bigint, b: bigint): bigint {
  const q = a / b;
  return a % b !== 0n && a < 0n !== b < 0n ? q - 1n : q;
}

/**
 * Desconto por valor presente de valores antecipados: `Σ valor − valor/(1+i)^m`, com
 * frações exatas (BigInt) e **arredondado para baixo** uma única vez no total, para
 * nunca prometer um centavo a mais. A taxa é lida como o decimal que ela representa.
 * @see RN 5.5, RN 6.5
 */
export function presentValueDiscount(
  items: readonly { amount: Cents; months: number }[],
  monthlyRate: number,
): Cents {
  if (!(monthlyRate >= 0 && monthlyRate < 1)) {
    throw new RangeError(`taxa mensal inválida: ${monthlyRate}`);
  }
  if (items.length === 0) return 0;
  const [p, q] = decimalToRational(monthlyRate);
  const base = q + p;
  const maxMonths = Math.max(...items.map((i) => i.months));
  let numerator = 0n;
  for (const { amount, months } of items) {
    assertCents(amount, 'valor');
    if (!Number.isSafeInteger(months) || months < 0) {
      throw new RangeError(`meses inválido: ${months}`);
    }
    const m = BigInt(months);
    numerator += BigInt(amount) * (base ** m - q ** m) * base ** (BigInt(maxMonths) - m);
  }
  return Number(floorDiv(numerator, base ** BigInt(maxMonths)));
}

const integerReais = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });

export interface FormatBRLOptions {
  /** Sem o símbolo "R$" (ex.: "1.234,56"). */
  symbol?: boolean;
  /** Sempre mostra o sinal ("+R$ 10,00" / "-R$ 10,00"). */
  signed?: boolean;
}

/**
 * Formata centavos em reais no padrão brasileiro: 123456 → "R$ 1.234,56".
 * O separador entre "R$" e o número é o espaço não separável (U+00A0), como no `Intl`.
 * Reais e centavos são formatados separadamente, sem divisão em ponto flutuante.
 */
export function formatBRL(
  cents: Cents,
  { symbol = true, signed = false }: FormatBRLOptions = {},
): string {
  assertCents(cents);
  const abs = Math.abs(cents);
  const reais = (abs - (abs % 100)) / 100;
  const number = `${integerReais.format(reais)},${String(abs % 100).padStart(2, '0')}`;
  const text = symbol ? `R$\u00a0${number}` : number;
  if (cents < 0) return `-${text}`;
  if (signed && cents > 0) return `+${text}`;
  return text;
}

/**
 * Converte texto digitado em reais para centavos, sem passar por `float`.
 * Aceita "1.234,56", "1234,5", "R$ 10", "-3,99", "0,07". Vírgula é o separador decimal;
 * pontos são separadores de milhar. Retorna `null` se o texto não for um valor válido.
 */
export function parseBRL(input: string): Cents | null {
  const cleaned = input.replace(/R\$/gi, '').replace(/\s/g, '');
  const match = /^([+-]?)(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/.exec(cleaned);
  if (!match) return null;
  const [, sign, intPart = '0', fracPart = ''] = match;
  const reais = Number(intPart.replace(/\./g, ''));
  const centavos = Number(fracPart.padEnd(2, '0'));
  const cents = reais * 100 + centavos;
  if (!Number.isSafeInteger(cents)) return null;
  return sign === '-' && cents !== 0 ? -cents : cents;
}
