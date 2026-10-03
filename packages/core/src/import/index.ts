import type { Cents } from '../money';
import type { ISODate } from '../dates';

/**
 * Importação de extratos (OFX e CSV): leitura, chave de deduplicação e regras de categoria.
 * Funções puras; quem chama compara com o que já existe e grava.
 */

export interface StatementEntry {
  date: ISODate;
  /** Com sinal: negativo = saída. */
  amount: Cents;
  description: string;
  /** Identificador do banco (FITID do OFX), quando existe. */
  fitId: string | null;
}

export interface ParsedStatement {
  entries: StatementEntry[];
  /** Mensagem para o usuário quando o arquivo não pôde ser lido. */
  error: string | null;
}

/** Minúsculas, sem acento e com espaços simples. */
export function normalizeText(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Valor de extrato em centavos, sem `float`. Aceita "1.234,56", "-1234.56", "R$ 10",
 * "1,234.56", "(25,90)" (negativo). Retorna `null` se não for um valor.
 */
export function parseStatementAmount(input: string): Cents | null {
  let text = input.replace(/R\$/gi, '').replace(/\s/g, '');
  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }
  if (text.startsWith('-')) {
    negative = !negative;
    text = text.slice(1);
  } else if (text.startsWith('+')) {
    text = text.slice(1);
  }
  if (!/^[\d.,]+$/.test(text) || !/\d/.test(text)) return null;

  const lastComma = text.lastIndexOf(',');
  const lastDot = text.lastIndexOf('.');
  let decimalAt = -1;
  if (lastComma >= 0 && lastDot >= 0) {
    decimalAt = Math.max(lastComma, lastDot);
  } else if (lastComma >= 0) {
    decimalAt = text.length - lastComma - 1 === 3 && text.split(',').length > 2 ? -1 : lastComma;
  } else if (lastDot >= 0) {
    const digitsAfter = text.length - lastDot - 1;
    // "1.234" é milhar (padrão BR); "12.5" e "12.50" são decimais.
    decimalAt = digitsAfter === 3 ? -1 : lastDot;
  }
  const intRaw = decimalAt >= 0 ? text.slice(0, decimalAt) : text;
  const fracRaw = decimalAt >= 0 ? text.slice(decimalAt + 1) : '';
  const intDigits = intRaw.replace(/[.,]/g, '');
  if (!/^\d*$/.test(intDigits) || !/^\d{0,2}$/.test(fracRaw)) return null;
  const cents = Number(intDigits || '0') * 100 + Number(fracRaw.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents)) return null;
  return negative && cents !== 0 ? -cents : cents;
}

/** Data `dd/mm/aaaa`, `dd/mm/aa`, `dd-mm-aaaa`, `aaaa-mm-dd` ou `aaaammdd` → `YYYY-MM-DD`. */
export function parseStatementDate(input: string): ISODate | null {
  const text = input.trim();
  let y: number;
  let m: number;
  let d: number;
  let match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text) ?? /^(\d{4})(\d{2})(\d{2})/.exec(text);
  if (match) {
    [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else {
    match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(text);
    if (!match) return null;
    d = Number(match[1]);
    m = Number(match[2]);
    y = Number(match[3]);
    if (y < 100) y += 2000;
  }
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) {
    return null;
  }
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'");
}

/** Extrato OFX (SGML da maioria dos bancos brasileiros ou XML): um item por `<STMTTRN>`. */
export function parseOFX(text: string): ParsedStatement {
  const blocks = text.match(/<STMTTRN>[\s\S]*?(?:<\/STMTTRN>|(?=<STMTTRN>|<\/BANKTRANLIST>|$))/gi);
  if (!blocks) {
    return { entries: [], error: 'Não encontrei lançamentos neste arquivo OFX.' };
  }
  const field = (block: string, tag: string): string | null => {
    const m = new RegExp(`<${tag}>([^<\\r\\n]*)`, 'i').exec(block);
    return m?.[1] ? decodeEntities(m[1].trim()) : null;
  };
  const entries: StatementEntry[] = [];
  for (const block of blocks) {
    const date = parseStatementDate(field(block, 'DTPOSTED') ?? '');
    const amount = parseStatementAmount(field(block, 'TRNAMT') ?? '');
    if (!date || amount === null || amount === 0) continue;
    const name = field(block, 'NAME');
    const memo = field(block, 'MEMO');
    const description =
      name && memo && normalizeText(memo) !== normalizeText(name)
        ? `${name} ${memo}`
        : (name ?? memo ?? '');
    entries.push({
      date,
      amount,
      description: description.replace(/\s+/g, ' ').trim() || 'Lançamento importado',
      fitId: field(block, 'FITID'),
    });
  }
  return entries.length
    ? { entries, error: null }
    : { entries, error: 'Nenhum lançamento válido no arquivo OFX.' };
}

/** Linhas de CSV com aspas (`"a;b"`, `""`), na vírgula, ponto e vírgula ou tab. */
export function splitCSV(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src.charAt(i);
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

function detectDelimiter(text: string): string {
  const header = text.replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0] ?? '';
  const counts = [';', '\t', ','].map((d) => [d, header.split(d).length - 1] as const);
  const best = counts.reduce((a, b) => (b[1] > a[1] ? b : a));
  return best[1] > 0 ? best[0] : ',';
}

const ALIASES = {
  date: ['data', 'date', 'dt', 'data lancamento', 'data mov', 'data movimento', 'data da compra'],
  description: [
    'descricao',
    'historico',
    'lancamento',
    'memo',
    'description',
    'title',
    'estabelecimento',
    'titulo',
    'detalhes',
    'nome',
  ],
  amount: ['valor', 'amount', 'quantia', 'valor (r$)', 'valor r$'],
  debit: ['debito', 'saida', 'saidas', 'debit', 'valor debito'],
  credit: ['credito', 'entrada', 'entradas', 'credit', 'valor credito'],
} as const;

function findColumn(headers: string[], aliases: readonly string[]): number {
  const exact = headers.findIndex((h) => aliases.includes(h));
  if (exact >= 0) return exact;
  return headers.findIndex((h) => aliases.some((a) => h.startsWith(a) || h.includes(` ${a}`)));
}

/**
 * Extrato em CSV com cabeçalho. Reconhece colunas de data, descrição e valor (ou
 * débito/crédito) pelos nomes comuns dos bancos. `invert` troca o sinal (extratos que
 * mostram a saída como positiva).
 */
export function parseCSVStatement(text: string, { invert = false } = {}): ParsedStatement {
  const rows = splitCSV(text, detectDelimiter(text));
  const headerRow = rows[0];
  if (!headerRow || rows.length < 2) {
    return { entries: [], error: 'O arquivo CSV está vazio ou sem linhas de lançamento.' };
  }
  const headers = headerRow.map(normalizeText);
  const dateCol = findColumn(headers, ALIASES.date);
  const descCol = findColumn(headers, ALIASES.description);
  const amountCol = findColumn(headers, ALIASES.amount);
  const debitCol = findColumn(headers, ALIASES.debit);
  const creditCol = findColumn(headers, ALIASES.credit);
  const hasAmount = amountCol >= 0 || (debitCol >= 0 && creditCol >= 0);
  if (dateCol < 0 || !hasAmount) {
    return {
      entries: [],
      error: `Não reconheci as colunas (data, descrição, valor). Colunas do arquivo: ${headerRow
        .map((h) => h.trim())
        .join(', ')}.`,
    };
  }
  const entries: StatementEntry[] = [];
  for (const row of rows.slice(1)) {
    const date = parseStatementDate(row[dateCol] ?? '');
    if (!date) continue;
    let amount: Cents | null;
    if (amountCol >= 0) {
      amount = parseStatementAmount(row[amountCol] ?? '');
    } else {
      const credit = parseStatementAmount(row[creditCol] ?? '') ?? 0;
      const debit = parseStatementAmount(row[debitCol] ?? '') ?? 0;
      amount = Math.abs(credit) - Math.abs(debit);
    }
    if (amount === null || amount === 0) continue;
    entries.push({
      date,
      amount: invert ? -amount : amount,
      description:
        (descCol >= 0 ? (row[descCol] ?? '') : '').replace(/\s+/g, ' ').trim() ||
        'Lançamento importado',
      fitId: null,
    });
  }
  return entries.length
    ? { entries, error: null }
    : { entries, error: 'Nenhum lançamento válido no arquivo CSV.' };
}

/**
 * Chaves de deduplicação, uma por item, na ordem do arquivo. Com FITID: `fit:<id>`.
 * Sem: `data|valor|descrição`, com contador para itens idênticos no mesmo arquivo
 * (dois cafés iguais no mesmo dia continuam sendo dois).
 */
export function importKeys(entries: readonly StatementEntry[]): string[] {
  const seen = new Map<string, number>();
  return entries.map((e) => {
    if (e.fitId) return `fit:${e.fitId}`;
    const base = `${e.date}|${e.amount}|${normalizeText(e.description).slice(0, 80)}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return `${base}#${n}`;
  });
}

export interface CategoryRuleLike {
  id: string;
  /** Trecho que a descrição deve conter (sem diferenciar maiúsculas e acentos). */
  pattern: string;
  categoryId: string;
}

/** Regra que casa com a descrição: vence o trecho mais longo (mais específico). */
export function matchCategoryRule<T extends CategoryRuleLike>(
  description: string,
  rules: readonly T[],
): T | null {
  const text = normalizeText(description);
  let best: T | null = null;
  let bestLen = 0;
  for (const rule of rules) {
    const pattern = normalizeText(rule.pattern);
    if (pattern.length > bestLen && text.includes(pattern)) {
      best = rule;
      bestLen = pattern.length;
    }
  }
  return best;
}

/** Trecho sugerido para uma regra: as 3 primeiras palavras sem números ("Pix Mercado 123" → "pix mercado"). */
export function suggestRulePattern(description: string): string {
  return normalizeText(description)
    .split(' ')
    .filter((w) => w.length > 1 && !/\d/.test(w))
    .slice(0, 3)
    .join(' ');
}

export interface PossibleDuplicate {
  date: ISODate;
  amount: Cents;
}

/**
 * Existe um lançamento do mesmo valor perto da data (tolerância em dias)? Pega o que a
 * pessoa já lançou à mão e que o banco compensou um ou dois dias depois.
 */
export function hasNearbyMatch(
  entry: PossibleDuplicate,
  existing: readonly PossibleDuplicate[],
  toleranceDays = 2,
): boolean {
  const t = Date.parse(`${entry.date}T00:00:00Z`);
  return existing.some(
    (e) =>
      e.amount === entry.amount &&
      Math.abs(Date.parse(`${e.date}T00:00:00Z`) - t) <= toleranceDays * 86_400_000,
  );
}

export interface ReconcileEntry {
  date: ISODate;
  /** Com sinal: + entrada, − saída. */
  amount: Cents;
}

export interface ReconcileCandidate extends ReconcileEntry {
  id: string;
  status: 'planned' | 'settled';
  /** Valor estimado (conta variável, salário que muda): aceita diferença no valor. */
  estimated: boolean;
  /** Já veio de uma importação (tem `import_key`). */
  imported: boolean;
}

/**
 * - `planned`: o item é o previsto (salário, conta fixa, parcela): confirmar o previsto.
 * - `settled`: já foi lançado à mão: não criar, só ligar o lançamento ao extrato.
 * - `possible`: parece o mesmo de outra importação: pular.
 */
export type ReconcileKind = 'planned' | 'settled' | 'possible';

export interface ReconcileMatch {
  id: string;
  kind: ReconcileKind;
}

const PLANNED_DAYS = 5;
const SETTLED_DAYS = 2;
const ESTIMATED_TOLERANCE = 0.3;

const dayDistance = (a: ISODate, b: ISODate) =>
  Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;

/**
 * Conciliação do extrato com o que já existe na conta. Lançado à mão: mesmo valor até 2
 * dias. Previsto: mesmo valor até 5 dias (o salário pode cair antes); se estimado, até 30%
 * de diferença. Mesmo sentido (entrada/saída) sempre. Cada lançamento existente casa com
 * um item só; prefere o já lançado, depois valor exato, depois a data mais próxima.
 * @see RN 8 (Importação)
 */
export function reconcileStatement(
  entries: readonly ReconcileEntry[],
  existing: readonly ReconcileCandidate[],
  /**
   * Janela em dias para previsto e para lançado à mão. Na fatura do cartão, quem chama já
   * filtrou os itens da mesma fatura e passa `Infinity` (a data do arquivo pode ser a da
   * compra original de um parcelado).
   */
  { plannedDays = PLANNED_DAYS, settledDays = SETTLED_DAYS } = {},
): (ReconcileMatch | null)[] {
  const used = new Set<string>();
  return entries.map((entry) => {
    let best: { c: ReconcileCandidate; score: number } | null = null;
    for (const c of existing) {
      if (used.has(c.id) || Math.sign(c.amount) !== Math.sign(entry.amount)) continue;
      const days = dayDistance(c.date, entry.date);
      const exact = c.amount === entry.amount;
      let ok: boolean;
      if (c.status === 'settled') ok = exact && days <= settledDays;
      else {
        const close =
          c.estimated &&
          Math.abs(Math.abs(entry.amount) - Math.abs(c.amount)) <=
            Math.abs(c.amount) * ESTIMATED_TOLERANCE;
        ok = days <= plannedDays && (exact || close);
      }
      if (!ok) continue;
      // Menor é melhor: já lançado < previsto; valor exato < aproximado; depois os dias.
      const score = (c.status === 'settled' ? 0 : 1000) + (exact ? 0 : 100) + days;
      if (!best || score < best.score) best = { c, score };
    }
    if (!best) return null;
    used.add(best.c.id);
    const kind: ReconcileKind =
      best.c.status === 'planned' ? 'planned' : best.c.imported ? 'possible' : 'settled';
    return { id: best.c.id, kind };
  });
}

/** Linha da fatura que é o pagamento da fatura anterior (não é compra nem estorno). */
export function isInvoicePaymentLine(description: string, amount: Cents): boolean {
  return amount > 0 && /\b(pagamento|pagto|pgto)\b/.test(normalizeText(description));
}
