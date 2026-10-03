import {
  bcbWindow,
  BCB_SERIES,
  IBGE_IPCA,
  INDEX_LABEL,
  IPEA_SERIES,
  parseBcbSeries,
  parseIbgeSeries,
  parseIpeaSeries,
  type IndexName,
  type ISODate,
  type MonthlyIndex,
} from '@finapp/core';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { indexValues } from '../db/schema';

type Fetcher = (
  url: string,
  init?: { signal?: AbortSignal },
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

const TIMEOUT_MS = 15_000;

export interface IndexSyncResult {
  /** Meses gravados ou atualizados por índice. */
  saved: Record<IndexName, number>;
  /** Mensagem por índice que não pôde ser buscado. */
  errors: Partial<Record<IndexName, string>>;
}

const bcbUrl = (index: IndexName, today: ISODate, months: number) => {
  const { from, to } = bcbWindow(today, months);
  return `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${BCB_SERIES[index]}/dados?formato=json&dataInicial=${from}&dataFinal=${to}`;
};
const ibgeUrl = (months: number) =>
  `https://servicodados.ibge.gov.br/api/v3/agregados/${IBGE_IPCA.aggregate}/periodos/-${months}/variaveis/${IBGE_IPCA.variable}?localidades=N1%5Ball%5D`;

// O IPEADATA ignora $top/$filter e devolve a série inteira (poucas centenas de linhas).
const ipeaUrl = (index: IndexName) =>
  `https://www.ipeadata.gov.br/api/odata4/ValoresSerie(SERCODIGO='${IPEA_SERIES[index]}')`;

interface Source {
  url: string;
  parse: (json: unknown) => MonthlyIndex[];
  name: string;
}

/** Fontes de cada índice, em ordem: a primeira que responder vale. */
function sources(index: IndexName, today: ISODate, months: number): Source[] {
  const bcb = { url: bcbUrl(index, today, months), parse: parseBcbSeries, name: 'Banco Central' };
  // Mesma janela do SGS: os `months` meses anteriores e o mês corrente.
  const ipea = {
    url: ipeaUrl(index),
    parse: (json: unknown) => parseIpeaSeries(json, months + 1),
    name: 'IPEADATA',
  };
  if (index === 'ipca') {
    return [{ url: ibgeUrl(months), parse: parseIbgeSeries, name: 'IBGE' }, bcb, ipea];
  }
  return [bcb, ipea];
}

async function load(fetcher: Fetcher, url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetcher(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Busca os últimos meses de INCC, IPCA e IGP-M nas fontes públicas (gratuitas) e grava em
 * `index_values`. Valor digitado à mão nunca é sobrescrito; um mês automático é atualizado
 * se a fonte revisar o número. Falha de uma fonte não derruba as outras.
 * @see RN 6.2
 */
export async function syncIndexValues(
  db: Db,
  today: ISODate,
  {
    months = 6,
    fetcher = fetch as unknown as Fetcher,
  }: { months?: number; fetcher?: Fetcher } = {},
): Promise<IndexSyncResult> {
  const result: IndexSyncResult = { saved: { incc: 0, ipca: 0, igpm: 0 }, errors: {} };
  for (const index of Object.keys(INDEX_LABEL) as IndexName[]) {
    let series: MonthlyIndex[] | null = null;
    const failures: string[] = [];
    for (const source of sources(index, today, months)) {
      try {
        const parsed = source.parse(await load(fetcher, source.url));
        if (parsed.length === 0) throw new Error('resposta sem valores');
        series = parsed;
        break;
      } catch (err) {
        failures.push(`${source.name}: ${err instanceof Error ? err.message : 'falhou'}`);
      }
    }
    if (!series) {
      result.errors[index] = failures.join('; ');
      continue;
    }
    for (const row of series) {
      const [existing] = await db
        .select()
        .from(indexValues)
        .where(and(eq(indexValues.index, index), eq(indexValues.month, row.month)));
      if (!existing) {
        await db
          .insert(indexValues)
          .values({ index, month: row.month, value: row.value, source: 'auto' })
          .onConflictDoNothing();
        result.saved[index]++;
      } else if (existing.source === 'auto' && existing.value !== row.value) {
        await db
          .update(indexValues)
          .set({ value: row.value })
          .where(eq(indexValues.id, existing.id));
        result.saved[index]++;
      }
    }
  }
  return result;
}
