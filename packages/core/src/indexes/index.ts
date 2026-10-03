/**
 * Índices de correção (INCC, IPCA, IGP-M): leitura das séries públicas do Banco Central
 * (SGS) e do IBGE (SIDRA). Funções puras; quem chama faz a requisição.
 * @see RN 6.2
 */

export type IndexName = 'incc' | 'ipca' | 'igpm';

export interface MonthlyIndex {
  /** `YYYY-MM` */
  month: string;
  /** Variação do mês como decimal: 0.0048 = 0,48%. */
  value: number;
}

/** Séries do SGS do Banco Central (variação mensal, %). */
export const BCB_SERIES: Record<IndexName, number> = { incc: 192, ipca: 433, igpm: 189 };

/** IPCA mensal no SIDRA/IBGE (agregado 1737, variável 63). */
export const IBGE_IPCA = { aggregate: 1737, variable: 63 } as const;

export const INDEX_LABEL: Record<IndexName, string> = { incc: 'INCC', ipca: 'IPCA', igpm: 'IGP-M' };

/** Percentual em texto ("0.48", "-0,32") para decimal com 8 casas; `null` se inválido. */
export function percentToDecimal(text: string | number): number | null {
  const n = typeof text === 'number' ? text : Number(String(text).trim().replace(',', '.'));
  if (!Number.isFinite(n)) return null;
  const value = Math.round(n * 1_000_000) / 100_000_000;
  return value > -1 && value < 1 ? value : null;
}

const MONTH_ASC = (a: MonthlyIndex, b: MonthlyIndex) => a.month.localeCompare(b.month);

/**
 * Série do SGS: `[{ "data": "01/09/2026", "valor": "0.48" }, ...]` (dd/mm/aaaa, valor em %).
 * Ignora linhas inválidas; um mês repetido fica com o último valor.
 */
export function parseBcbSeries(json: unknown): MonthlyIndex[] {
  if (!Array.isArray(json)) return [];
  const byMonth = new Map<string, number>();
  for (const row of json as { data?: unknown; valor?: unknown }[]) {
    const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(row?.data ?? ''));
    const value = percentToDecimal(row?.valor as string);
    if (!match || value === null) continue;
    byMonth.set(`${match[3]}-${match[2]}`, value);
  }
  return [...byMonth].map(([month, value]) => ({ month, value })).sort(MONTH_ASC);
}

/**
 * Resposta do SIDRA para o IPCA:
 * `[{ resultados: [{ series: [{ serie: { "202608": "-0.32" } }] }] }]` (período aaaamm, %).
 */
export function parseIbgeSeries(json: unknown): MonthlyIndex[] {
  const serie = (
    json as {
      resultados?: { series?: { serie?: Record<string, string> }[] }[];
    }[]
  )?.[0]?.resultados?.[0]?.series?.[0]?.serie;
  if (!serie || typeof serie !== 'object') return [];
  const out: MonthlyIndex[] = [];
  for (const [period, raw] of Object.entries(serie)) {
    const match = /^(\d{4})(\d{2})$/.exec(period);
    const value = percentToDecimal(raw);
    if (match && value !== null) out.push({ month: `${match[1]}-${match[2]}`, value });
  }
  return out.sort(MONTH_ASC);
}

/** Séries mensais do IPEADATA (Ipea), usadas como reserva do Banco Central. */
export const IPEA_SERIES: Record<IndexName, string> = {
  incc: 'IGP12_INCCMG12',
  ipca: 'PRECOS12_IPCAG12',
  igpm: 'IGP12_IGPMG12',
};

/**
 * Série do IPEADATA (OData): `{ value: [{ VALDATA: "2026-09-01T00:00:00-03:00", VALVALOR: 0.25 }] }`
 * (valor em %). A API devolve a série inteira; `months` mantém só os últimos meses.
 */
export function parseIpeaSeries(json: unknown, months?: number): MonthlyIndex[] {
  const rows = (json as { value?: unknown })?.value;
  if (!Array.isArray(rows)) return [];
  const byMonth = new Map<string, number>();
  for (const row of rows as { VALDATA?: unknown; VALVALOR?: unknown }[]) {
    const match = /^(\d{4})-(\d{2})-\d{2}T/.exec(String(row?.VALDATA ?? ''));
    if (!match || (typeof row.VALVALOR !== 'number' && typeof row.VALVALOR !== 'string')) continue;
    const value = percentToDecimal(row.VALVALOR);
    if (value === null) continue;
    byMonth.set(`${match[1]}-${match[2]}`, value);
  }
  const all = [...byMonth].map(([month, value]) => ({ month, value })).sort(MONTH_ASC);
  return months === undefined ? all : all.slice(-months);
}

/** Datas `dd/mm/aaaa` da janela de busca no SGS (de `months` meses atrás até hoje). */
export function bcbWindow(today: string, months: number): { from: string; to: string } {
  const [y, m, d] = today.split('-').map(Number) as [number, number, number];
  const index = y * 12 + (m - 1) - months;
  const fy = Math.floor(index / 12);
  const fm = (index % 12) + 1;
  const pad = (n: number) => String(n).padStart(2, '0');
  return { from: `01/${pad(fm)}/${fy}`, to: `${pad(d)}/${pad(m)}/${y}` };
}
