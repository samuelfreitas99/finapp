import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { indexValues } from '../db/schema';
import { createTempDb, testDatabaseUrl } from '../test/temp-db';
import { syncIndexValues } from './indexes';

describe.skipIf(!testDatabaseUrl)('index sync (integration)', () => {
  let drop: () => Promise<void>;
  let db: Awaited<ReturnType<typeof createTempDb>>['db'];

  beforeAll(async () => {
    const temp = await createTempDb();
    drop = temp.drop;
    db = temp.db;
  });

  afterAll(async () => {
    await drop?.();
  });

  const reply = (body: unknown, ok = true, status = 200) => ({
    ok,
    status,
    json: async () => body,
  });

  const bcb = (rows: [string, string][]) => rows.map(([data, valor]) => ({ data, valor }));
  const ibge = (serie: Record<string, string>) => [{ resultados: [{ series: [{ serie }] }] }];

  const valueOf = async (index: 'incc' | 'ipca' | 'igpm', month: string) =>
    (
      await db
        .select()
        .from(indexValues)
        .where(and(eq(indexValues.index, index), eq(indexValues.month, month)))
    )[0];

  it('fetches each index, falls back for IPCA and reports failures per index', async () => {
    const calls: string[] = [];
    const fetcher = async (url: string) => {
      calls.push(url);
      if (url.includes('servicodados.ibge')) return reply(null, false, 503); // IBGE fora
      if (url.includes('sgs.433'))
        return reply(
          bcb([
            ['01/08/2026', '-0.32'],
            ['01/09/2026', '0.48'],
          ]),
        );
      if (url.includes('sgs.192')) return reply(bcb([['01/09/2026', '0.55']]));
      throw new Error('sem rede'); // IGP-M falha
    };
    const result = await syncIndexValues(db, '2026-10-03', { fetcher });
    expect(result.saved).toEqual({ incc: 1, ipca: 2, igpm: 0 });
    expect(result.errors.igpm).toMatch(/Banco Central: sem rede/);
    expect(result.errors.ipca).toBeUndefined();
    const ibgeAt = calls.findIndex((u) => u.includes('servicodados.ibge.gov.br'));
    const fallbackAt = calls.findIndex((u) => u.includes('sgs.433'));
    expect(ibgeAt).toBeGreaterThanOrEqual(0);
    expect(ibgeAt).toBeLessThan(fallbackAt);
    expect(calls.some((u) => u.includes('sgs.433') && u.includes('dataInicial=01/04/2026'))).toBe(
      true,
    );
    expect(await valueOf('ipca', '2026-09')).toMatchObject({ value: 0.0048, source: 'auto' });
    expect(await valueOf('incc', '2026-09')).toMatchObject({ value: 0.0055, source: 'auto' });
  });

  it('updates revised automatic values but never overwrites manual ones', async () => {
    await db
      .update(indexValues)
      .set({ source: 'manual', value: 0.0099 })
      .where(and(eq(indexValues.index, 'incc'), eq(indexValues.month, '2026-09')));
    const fetcher = async (url: string) => {
      if (url.includes('sgs.192')) return reply(bcb([['01/09/2026', '0.61']]));
      if (url.includes('sgs.433')) return reply(bcb([['01/09/2026', '0.50']]));
      return reply(null, false, 500);
    };
    const result = await syncIndexValues(db, '2026-10-03', { fetcher });
    expect((await valueOf('incc', '2026-09'))?.value).toBe(0.0099);
    expect(result.saved.incc).toBe(0);
    expect((await valueOf('ipca', '2026-09'))?.value).toBe(0.005);
    // Rodar de novo com os mesmos dados não grava nada.
    expect((await syncIndexValues(db, '2026-10-03', { fetcher })).saved).toEqual({
      incc: 0,
      ipca: 0,
      igpm: 0,
    });
  });

  it('reports an index when every source is down or returns nothing', async () => {
    const result = await syncIndexValues(db, '2026-10-03', {
      fetcher: async () => reply([]),
    });
    expect(Object.keys(result.errors).sort()).toEqual(['igpm', 'incc', 'ipca']);
    expect(result.errors.ipca).toMatch(
      /IBGE: resposta sem valores; Banco Central: resposta sem valores/,
    );
  });

  it('falls back to IPEADATA when the Banco Central is down', async () => {
    const ipea = (code: string, rows: [string, number][]) => ({
      value: rows.map(([month, v]) => ({
        SERCODIGO: code,
        VALDATA: `${month}-01T00:00:00-03:00`,
        VALVALOR: v,
      })),
    });
    // Série inteira desde 2025: só os 6 meses anteriores e o corrente são gravados.
    const months = Array.from({ length: 20 }, (_, i) => {
      const n = 2025 * 12 + i;
      return `${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, '0')}`;
    });
    const fetcher = async (url: string) => {
      if (url.includes('api.bcb.gov.br')) throw new Error('getaddrinfo ENOTFOUND');
      if (url.includes("'IGP12_IGPMG12'"))
        return reply(
          ipea(
            'IGP12_IGPMG12',
            months.map((m) => [m, 1.57]),
          ),
        );
      if (url.includes("'IGP12_INCCMG12'"))
        return reply(ipea('IGP12_INCCMG12', [['2028-04', 0.25]]));
      return reply(null, false, 503);
    };
    const result = await syncIndexValues(db, '2026-08-10', { fetcher });
    expect(result.errors.igpm).toBeUndefined();
    expect(result.errors.incc).toBeUndefined();
    expect(result.saved.igpm).toBe(7);
    expect(await valueOf('igpm', '2026-08')).toMatchObject({ value: 0.0157, source: 'auto' });
    expect(await valueOf('igpm', '2026-01')).toBeUndefined();
    expect(await valueOf('incc', '2028-04')).toMatchObject({ value: 0.0025, source: 'auto' });
    expect(result.errors.ipca).toMatch(
      /IBGE: HTTP 503; Banco Central: getaddrinfo ENOTFOUND; IPEADATA: HTTP 503/,
    );
  });

  it('prefers IBGE for IPCA when it answers', async () => {
    const urls: string[] = [];
    const fetcher = async (url: string) => {
      urls.push(url);
      if (url.includes('servicodados.ibge')) return reply(ibge({ '202610': '0.21' }));
      return reply([]);
    };
    const result = await syncIndexValues(db, '2026-11-03', { fetcher });
    expect(result.saved.ipca).toBe(1);
    expect(urls.some((u) => u.includes('sgs.433'))).toBe(false);
    expect(await valueOf('ipca', '2026-10')).toMatchObject({ value: 0.0021, source: 'auto' });
  });
});
