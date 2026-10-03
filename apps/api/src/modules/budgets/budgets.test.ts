import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app';
import { createAuth } from '../../auth/auth';
import { createAdminInvite } from '../../cli/create-invite';
import type { Db } from '../../db/client';
import { notifications } from '../../db/schema';
import { generateAlerts } from '../../jobs/alerts';
import { createTempDb, testDatabaseUrl } from '../../test/temp-db';

const appUrl = 'http://localhost:5174';
const TODAY = '2026-10-15';

describe.skipIf(!testDatabaseUrl)('budgets API (integration)', () => {
  let drop: () => Promise<void>;
  let db: Db;
  let app: ReturnType<typeof buildApp>;
  let cookie: string;
  let spaceId: string;
  let accountId: string;
  let cardId: string;
  let categories: Record<string, string>;

  /** Id da n-ésima categoria de despesa principal. */
  const catAt = (n: number): string => {
    const id = Object.values(categories)[n];
    if (!id) throw new Error(`categoria ${n} não existe`);
    return id;
  };

  type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';
  const api = (method: Method, path: string, payload?: unknown) =>
    app.inject({
      method,
      url: `/api/spaces/${spaceId}${path}`,
      headers: { cookie, origin: appUrl },
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });

  const spend = (categoryId: string, amount: number, date = '2026-10-10', extra = {}) =>
    api('POST', '/transactions', {
      type: 'expense',
      status: 'settled',
      amount,
      date,
      description: 'Gasto',
      categoryId,
      accountId,
      ...extra,
    });

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
    cookie = (Array.isArray(raw) ? raw : [String(raw)]).map((c) => c.split(';')[0]).join('; ');
    spaceId = (await app.inject({ method: 'GET', url: '/api/me', headers: { cookie } })).json()
      .activeSpaceId;
    accountId = (
      await api('POST', '/accounts', {
        name: 'Conta',
        type: 'checking',
        initialBalance: 1000000,
        initialDate: '2026-01-01',
      })
    ).json().id;
    cardId = (
      await api('POST', '/cards', {
        name: 'Nubank',
        limitAmount: 500000,
        closingDay: 5,
        dueDay: 12,
      })
    ).json().id;
    const list = (await api('GET', '/categories?kind=expense')).json().items as {
      id: string;
      name: string;
      parentId: string | null;
    }[];
    categories = Object.fromEntries(list.filter((c) => !c.parentId).map((c) => [c.name, c.id]));
  });

  afterAll(async () => {
    await app?.close();
    await drop?.();
  });

  it('tracks consumption, card by invoice month, refunds and subcategories', async () => {
    const catId = catAt(0);
    const created = await api('PUT', '/budgets', { categoryId: catId, amount: 100000 });
    expect(created.statusCode).toBe(201);

    await spend(catId, 50000);
    // Compra no cartão em 10/10 (fecha dia 5): vai para a fatura de novembro, não conta em outubro.
    await api('POST', '/transactions', {
      type: 'expense',
      status: 'settled',
      amount: 30000,
      date: '2026-10-10',
      description: 'Cartão',
      categoryId: catId,
      cardId,
    });
    // Compra no cartão em 02/10 (antes do fechamento): fatura de outubro.
    await api('POST', '/transactions', {
      type: 'expense',
      status: 'settled',
      amount: 10000,
      date: '2026-10-02',
      description: 'Cartão',
      categoryId: catId,
      cardId,
    });
    // Previsto e de outra categoria não contam.
    await spend(catId, 99999, '2026-10-20', { status: 'planned' });
    await spend(catAt(1), 77777);

    const res = await api('GET', '/budgets?month=2026-10');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      categoryId: catId,
      limit: 100000,
      spent: 60000,
      remaining: 40000,
      level: 'ok',
    });

    const nov = (await api('GET', '/budgets?month=2026-11')).json();
    expect(nov.items[0]).toMatchObject({ spent: 30000, level: 'ok' });
  });

  it('validates the category and replaces instead of duplicating', async () => {
    const catId = catAt(0);
    const again = await api('PUT', '/budgets', {
      categoryId: catId,
      amount: 70000,
      rollover: true,
    });
    expect(again.statusCode).toBe(200);
    expect((await api('GET', '/budgets?month=2026-10')).json().items).toHaveLength(1);

    const income = (await api('GET', '/categories?kind=income')).json().items[0];
    expect((await api('PUT', '/budgets', { categoryId: income.id, amount: 1000 })).statusCode).toBe(
      400,
    );
    expect((await api('PUT', '/budgets', { categoryId: catId, amount: -1 })).statusCode).toBe(400);
  });

  it('lets a specific month override the general limit and carries leftovers', async () => {
    const catId = catAt(0);
    // Geral (rollover) de 700,00; outubro específico de 500,00.
    await api('PUT', '/budgets', { categoryId: catId, month: '2026-10', amount: 50000 });
    const oct = (await api('GET', '/budgets?month=2026-10')).json().items[0];
    expect(oct).toMatchObject({ month: '2026-10', limit: 50000, spent: 60000, level: 'exceeded' });
    expect(oct.remaining).toBe(-10000);

    // Novembro volta ao geral; sem rollover do mês anterior (orçamento criado em out/2026
    // com histórico só a partir da criação, e outubro estourou: sobra zero).
    const nov = (await api('GET', '/budgets?month=2026-11')).json().items[0];
    expect(nov).toMatchObject({ month: null, limit: 70000, carry: 0 });
  });

  it('creates budget alerts once per category, month and level', async () => {
    const first = await generateAlerts(db, TODAY);
    expect(first).toBeGreaterThanOrEqual(1);
    const rows = (await db.select().from(notifications)).filter((n) => n.type === 'budget');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.title).toMatch(/estourou/);
    await generateAlerts(db, TODAY);
    expect((await db.select().from(notifications)).filter((n) => n.type === 'budget')).toHaveLength(
      1,
    );
  });

  it('removes a budget logically and isolates by space', async () => {
    const items = (await api('GET', '/budgets?month=2026-10')).json().items;
    expect((await api('DELETE', `/budgets/${items[0].id}`)).statusCode).toBe(204);
    expect((await api('DELETE', `/budgets/${items[0].id}`)).statusCode).toBe(404);
    const other = await app.inject({
      method: 'GET',
      url: `/api/spaces/00000000-0000-4000-8000-000000000000/budgets`,
      headers: { cookie },
    });
    expect(other.statusCode).toBe(404);
  });
});
