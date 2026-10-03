import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import { createAuth } from '../auth/auth';
import { createAdminInvite } from '../cli/create-invite';
import type { Db } from '../db/client';
import { notifications } from '../db/schema';
import { createTempDb, testDatabaseUrl } from '../test/temp-db';
import { generateSummaries } from './summaries';

const appUrl = 'http://localhost:5174';
const TODAY = '2026-10-15';

describe.skipIf(!testDatabaseUrl)('push summaries (integration)', () => {
  let drop: () => Promise<void>;
  let db: Db;
  let app: ReturnType<typeof buildApp>;
  let cookie: string;
  let spaceId: string;
  let accountId: string;
  let userId: string;

  const call = (method: 'GET' | 'POST' | 'PATCH', path: string, payload?: unknown) =>
    app.inject({
      method,
      url: path,
      headers: { cookie, origin: appUrl },
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });
  const plain = (t: string) => t.replace(/\u00a0/g, ' ');
  const mine = async (type: string) =>
    (await db.select().from(notifications)).filter((n) => n.type === type);

  beforeAll(async () => {
    const temp = await createTempDb();
    drop = temp.drop;
    db = temp.db;
    const auth = createAuth({
      db,
      secret: 'test-secret-test-secret-test-secret-00',
      appUrl,
      production: false,
    });
    app = buildApp({ db, auth, appUrl, today: () => TODAY });
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { origin: appUrl },
      payload: {
        name: 'Samuel',
        email: 'samuel@ex.com',
        password: 'senha-forte-1',
        inviteCode: await createAdminInvite(temp.url),
      },
    });
    const raw = res.headers['set-cookie'];
    cookie = (Array.isArray(raw) ? raw : [String(raw)])
      .map((c) => String(c).split(';')[0])
      .join('; ');
    const me = (await call('GET', '/api/me')).json();
    spaceId = me.activeSpaceId;
    userId = me.user.id;
    accountId = (
      await call('POST', `/api/spaces/${spaceId}/accounts`, {
        name: 'Conta',
        type: 'checking',
        initialBalance: 1000000,
        initialDate: '2026-01-01',
      })
    ).json().id;
    const cats = (await call('GET', `/api/spaces/${spaceId}/categories?kind=expense`)).json().items;
    const entry = (
      type: string,
      status: string,
      amount: number,
      date: string,
      categoryId?: string,
    ) =>
      call('POST', `/api/spaces/${spaceId}/transactions`, {
        type,
        status,
        amount,
        date,
        description: 'Item',
        accountId,
        ...(categoryId ? { categoryId } : {}),
      });
    // Semana de 28/09 a 04/10 (a segunda é 05/10): gastos e uma receita.
    await entry('expense', 'settled', 30000, '2026-09-29', cats[0].id);
    await entry('expense', 'settled', 10000, '2026-10-02', cats[1].id);
    await entry('income', 'settled', 500000, '2026-10-01');
    // Semana anterior (21 a 27/09).
    await entry('expense', 'settled', 20000, '2026-09-23', cats[0].id);
    // Vence na próxima semana.
    await entry('expense', 'planned', 15000, '2026-10-08');
    // Mês de setembro inteiro para o resumo mensal.
    await entry('expense', 'settled', 5000, '2026-09-10', cats[1].id);
  });

  afterAll(async () => {
    await drop?.();
    await app?.close();
  });

  it('is off by default and sends nothing until the user turns it on', async () => {
    const settings = (await call('GET', '/api/notification-settings')).json();
    const types = Object.fromEntries(
      settings.types.map((t: { type: string; enabled: boolean }) => [t.type, t.enabled]),
    );
    expect(types.weekly_summary).toBe(false);
    expect(types.monthly_summary).toBe(false);
    expect(await generateSummaries(db, '2026-10-05')).toBe(0);
    expect(await mine('weekly_summary')).toHaveLength(0);
  });

  it('sends the weekly summary on Mondays, once, with totals, top category and upcoming dues', async () => {
    await call('PATCH', '/api/notification-settings', {
      types: [
        { type: 'weekly_summary', enabled: true },
        { type: 'monthly_summary', enabled: true },
      ],
    });
    expect(await generateSummaries(db, '2026-10-04')).toBe(0); // domingo: nada
    expect(await generateSummaries(db, '2026-10-05')).toBe(1);
    const [n] = await mine('weekly_summary');
    expect(n?.userId).toBe(userId);
    expect(plain(n?.title ?? '')).toBe('Sua semana (28/09 a 04/10): gastou R$ 400,00');
    const body = plain(n?.body ?? '');
    expect(body).toContain('Entrou R$ 5.000,00, saiu R$ 400,00.');
    expect(body).toMatch(/Maior gasto: .+ \(R\$ 300,00\)\./);
    expect(body).toContain('Gastou 100% a mais em relação à semana anterior.');
    expect(body).toContain('Nos próximos 7 dias: 1 vencimento (R$ 150,00).');
    expect(n?.url).toBe('/lancamentos');
    // Segunda vez no mesmo dia não duplica.
    expect(await generateSummaries(db, '2026-10-05')).toBe(0);
    expect(await mine('weekly_summary')).toHaveLength(1);
  });

  it('sends the monthly summary on the 1st for the previous month', async () => {
    expect(await generateSummaries(db, '2026-10-01')).toBe(1);
    const [n] = await mine('monthly_summary');
    expect(plain(n?.title ?? '')).toContain('Resumo de setembro de 2026: faltaram');
    expect(plain(n?.body ?? '')).toContain('saiu R$ 550,00');
    expect(n?.url).toBe('/relatorios');
    expect(await generateSummaries(db, '2026-10-01')).toBe(0);
  });

  it('respects turning the summary off again', async () => {
    await call('PATCH', '/api/notification-settings', {
      types: [{ type: 'weekly_summary', enabled: false }],
    });
    expect(await generateSummaries(db, '2026-10-12')).toBe(0);
  });
});
