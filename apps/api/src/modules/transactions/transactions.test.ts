import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app';
import { createAuth } from '../../auth/auth';
import { createAdminInvite } from '../../cli/create-invite';
import { createTempDb, testDatabaseUrl } from '../../test/temp-db';

const appUrl = 'http://localhost:5174';
const TODAY = '2026-10-15';

describe.skipIf(!testDatabaseUrl)('accounts, categories and transactions API (integration)', () => {
  let drop: () => Promise<void>;
  let url: string;
  let app: ReturnType<typeof buildApp>;
  let cookie: string;
  let spaceId: string;
  let otherCookie: string;
  let otherSpaceId: string;

  type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';
  const call = (method: Method, path: string, payload?: unknown, as = cookie) =>
    app.inject({
      method,
      url: path,
      headers: { cookie: as, origin: appUrl },
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });
  const api = (method: Method, path: string, payload?: unknown, as = cookie) =>
    call(method, `/api/spaces/${spaceId}${path}`, payload, as);

  const signUp = async (name: string, email: string) => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { origin: appUrl },
      payload: { name, email, password: 'senha-forte-1', inviteCode: await createAdminInvite(url) },
    });
    const raw = res.headers['set-cookie'];
    const c = (Array.isArray(raw) ? raw : [String(raw)]).map((x) => x.split(';')[0]).join('; ');
    const me = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: c } });
    return { cookie: c, spaceId: me.json().activeSpaceId as string };
  };

  beforeAll(async () => {
    const temp = await createTempDb();
    drop = temp.drop;
    url = temp.url;
    const auth = createAuth({
      db: temp.db,
      secret: 'test-secret-test-secret-test-secret-00',
      appUrl,
      production: false,
    });
    app = buildApp({ db: temp.db, auth, appUrl, today: () => TODAY });
    ({ cookie, spaceId } = await signUp('Samuel', 'samuel@ex.com'));
    ({ cookie: otherCookie, spaceId: otherSpaceId } = await signUp('Outra', 'outra@ex.com'));
  });

  afterAll(async () => {
    await app?.close();
    await drop?.();
  });

  const createAccount = async (name: string, initialBalance = 0, initialDate = '2026-10-01') => {
    const res = await api('POST', '/accounts', {
      name,
      type: 'checking',
      initialBalance,
      initialDate,
    });
    expect(res.statusCode).toBe(201);
    return res.json() as { id: string; balance: number; forecastBalance: number };
  };

  const categoryId = async (name: string) => {
    const res = await api('GET', '/categories');
    const found = (res.json().items as { id: string; name: string }[]).find((c) => c.name === name);
    if (!found) throw new Error(`categoria ${name} não encontrada`);
    return found.id;
  };

  it('requires login and space membership', async () => {
    expect((await call('GET', `/api/spaces/${spaceId}/accounts`, undefined, '')).statusCode).toBe(
      401,
    );
    const foreign = await call('GET', `/api/spaces/${spaceId}/accounts`, undefined, otherCookie);
    expect(foreign.statusCode).toBe(404);
    expect(foreign.json().error.code).toBe('space_not_found');
  });

  it('creates accounts and computes current and forecast balances', async () => {
    const acc = await createAccount('Nubank', 100000);
    expect(acc).toMatchObject({ balance: 100000, forecastBalance: 100000 });
    const food = await categoryId('Alimentação');
    const salary = await categoryId('Salário');

    const post = (body: Record<string, unknown>) =>
      api('POST', '/transactions', { accountId: acc.id, ...body });
    expect(
      (
        await post({
          type: 'income',
          amount: 500000,
          date: '2026-10-05',
          description: 'Salário',
          categoryId: salary,
        })
      ).statusCode,
    ).toBe(201);
    const pix = await post({
      type: 'expense',
      amount: 4590,
      date: '2026-10-14',
      description: 'Almoço',
      categoryId: food,
      paymentMethod: 'pix',
      pixCounterparty: 'Restaurante Bom Prato',
    });
    expect(pix.statusCode).toBe(201);
    expect(pix.json()).toMatchObject({ status: 'settled', paymentMethod: 'pix' });
    // Previsto no fim do mês e em novembro.
    await post({
      type: 'expense',
      status: 'planned',
      amount: 150000,
      date: '2026-10-20',
      description: 'Aluguel',
    });
    await post({
      type: 'expense',
      status: 'planned',
      amount: 9999,
      date: '2026-11-03',
      description: 'Internet',
    });

    const res = await api('GET', `/accounts/${acc.id}`);
    expect(res.json()).toMatchObject({
      balance: 100000 + 500000 - 4590,
      forecastBalance: 100000 + 500000 - 4590 - 150000,
      forecastDate: '2026-10-31',
    });
    const at = await api('GET', `/accounts/${acc.id}/balance?date=2026-11-30`);
    expect(at.json()).toMatchObject({
      today: TODAY,
      current: 595410,
      forecast: 595410 - 150000 - 9999,
    });

    const search = await api('GET', '/transactions?q=bom%20prato');
    expect(search.json().items).toHaveLength(1);
    const pixOnly = await api('GET', '/transactions?paymentMethod=pix');
    expect(pixOnly.json().items.map((t: { id: string }) => t.id)).toEqual([pix.json().id]);
  });

  it('validates transactions', async () => {
    const acc = await createAccount('Validação', 0, '2026-10-10');
    const base = { type: 'expense', accountId: acc.id, amount: 100, description: 'X' };
    const code = async (body: Record<string, unknown>) =>
      (await api('POST', '/transactions', { ...base, ...body })).json().error?.code;

    expect(await code({ date: '2026-10-20' })).toBe('settled_in_future');
    expect(await code({ date: '2026-10-09' })).toBe('date_before_initial_balance');
    expect(await code({ date: '2026-10-11', categoryId: await categoryId('Salário') })).toBe(
      'category_kind_mismatch',
    );
    expect(await code({ date: '2026-10-11', amount: -5 })).toBe('validation_error');
    expect(await code({ date: '2026-02-30' })).toBe('validation_error');
    expect(await code({ date: '2026-10-11', pixCounterparty: 'Fulano' })).toBe('validation_error');

    const cats = await api('GET', '/categories?includeSystem=true');
    const adjustment = cats
      .json()
      .items.find((c: { systemKey: string | null }) => c.systemKey === 'adjustment');
    expect(await code({ date: '2026-10-11', categoryId: adjustment.id })).toBe('system_category');

    // Conta de outro espaço não é encontrada.
    const foreign = await call(
      'POST',
      `/api/spaces/${otherSpaceId}/accounts`,
      {
        name: 'Dela',
        type: 'cash',
        initialDate: '2026-10-01',
      },
      otherCookie,
    );
    expect(await code({ date: '2026-10-11', accountId: foreign.json().id })).toBe('not_found');
  });

  it('settles a planned transaction', async () => {
    const acc = await createAccount('Efetivar');
    const planned = await api('POST', '/transactions', {
      type: 'expense',
      status: 'planned',
      accountId: acc.id,
      amount: 20000,
      date: '2026-10-12',
      description: 'Luz',
    });
    const settled = await api('POST', `/transactions/${planned.json().id}/settle`, {
      amount: 21345,
    });
    expect(settled.statusCode).toBe(200);
    expect(settled.json()).toMatchObject({ status: 'settled', amount: 21345, date: '2026-10-12' });
    expect(settled.json().settledAt).not.toBeNull();
    expect((await api('POST', `/transactions/${planned.json().id}/settle`, {})).statusCode).toBe(
      400,
    );
    expect((await api('GET', `/accounts/${acc.id}`)).json().balance).toBe(-21345);
  });

  it('transfers between accounts, edits and deletes both legs', async () => {
    const from = await createAccount('Origem', 100000);
    const to = await createAccount('Destino');
    const res = await api('POST', '/transfers', {
      fromAccountId: from.id,
      toAccountId: to.id,
      amount: 30000,
      date: '2026-10-14',
    });
    expect(res.statusCode).toBe(201);
    const { transferId, items } = res.json();
    expect(items.map((t: { type: string }) => t.type)).toEqual(['transfer_out', 'transfer_in']);
    expect(items.every((t: { transferId: string }) => t.transferId === transferId)).toBe(true);
    expect((await api('GET', `/accounts/${from.id}`)).json().balance).toBe(70000);
    expect((await api('GET', `/accounts/${to.id}`)).json().balance).toBe(30000);

    const patched = await api('PATCH', `/transactions/${items[1].id}`, { amount: 25000 });
    expect(patched.statusCode).toBe(200);
    expect((await api('GET', `/accounts/${from.id}`)).json().balance).toBe(75000);
    expect(
      (await api('PATCH', `/transactions/${items[0].id}`, { accountId: to.id })).json().error.code,
    ).toBe('same_account');
    expect(
      (await api('PATCH', `/transactions/${items[0].id}`, { paymentMethod: 'pix' })).json().error
        .code,
    ).toBe('transfer_field');

    expect((await api('DELETE', `/transactions/${items[0].id}`)).statusCode).toBe(204);
    expect((await api('GET', `/accounts/${to.id}`)).json().balance).toBe(0);
    expect((await api('GET', `/transactions?accountId=${from.id}`)).json().items).toHaveLength(0);

    expect(
      (
        await api('POST', '/transfers', {
          fromAccountId: from.id,
          toAccountId: from.id,
          amount: 1,
          date: '2026-10-14',
        })
      ).statusCode,
    ).toBe(400);
  });

  it('adjusts the balance to the real amount', async () => {
    const acc = await createAccount('Carteira', 5000);
    const down = await api('POST', '/adjustments', { accountId: acc.id, realBalance: 4250 });
    expect(down.statusCode).toBe(201);
    expect(down.json()).toMatchObject({
      balance: 4250,
      adjustment: { type: 'adjustment', amount: -750, date: TODAY },
    });
    const same = await api('POST', '/adjustments', { accountId: acc.id, realBalance: 4250 });
    expect(same.statusCode).toBe(200);
    expect(same.json()).toEqual({ adjustment: null, balance: 4250 });
    const up = await api('POST', '/adjustments', { accountId: acc.id, realBalance: 10000 });
    expect(up.json().adjustment.amount).toBe(5750);
    expect((await api('GET', `/accounts/${acc.id}`)).json().balance).toBe(10000);
    expect(
      (await api('PATCH', `/transactions/${down.json().adjustment.id}`, { amount: 1 })).json().error
        .code,
    ).toBe('adjustment_locked');
  });

  it('paginates by cursor (date desc)', async () => {
    const acc = await createAccount('Paginação');
    for (let d = 1; d <= 5; d++) {
      await api('POST', '/transactions', {
        type: 'income',
        accountId: acc.id,
        amount: d,
        date: `2026-10-0${d}`,
        description: `Item ${d}`,
      });
    }
    const page1 = (await api('GET', `/transactions?accountId=${acc.id}&limit=2`)).json();
    expect(page1.items.map((t: { amount: number }) => t.amount)).toEqual([5, 4]);
    const page2 = (
      await api('GET', `/transactions?accountId=${acc.id}&limit=2&cursor=${page1.nextCursor}`)
    ).json();
    expect(page2.items.map((t: { amount: number }) => t.amount)).toEqual([3, 2]);
    const page3 = (
      await api('GET', `/transactions?accountId=${acc.id}&limit=2&cursor=${page2.nextCursor}`)
    ).json();
    expect(page3.items.map((t: { amount: number }) => t.amount)).toEqual([1]);
    expect(page3.nextCursor).toBeNull();
    expect((await api('GET', '/transactions?cursor=lixo')).json().error.code).toBe(
      'invalid_cursor',
    );
  });

  it('archives instead of deleting accounts with transactions', async () => {
    const acc = await createAccount('Antiga');
    await api('POST', '/transactions', {
      type: 'income',
      accountId: acc.id,
      amount: 100,
      date: '2026-10-02',
      description: 'X',
    });
    const del = await api('DELETE', `/accounts/${acc.id}`);
    expect(del.statusCode).toBe(409);
    expect(del.json().error.code).toBe('account_has_transactions');
    expect(
      (await api('PATCH', `/accounts/${acc.id}`, { initialDate: '2026-10-05' })).statusCode,
    ).toBe(409);
    const archived = await api('PATCH', `/accounts/${acc.id}`, { archived: true });
    expect(archived.json().archived).toBe(true);
    expect(
      (await api('GET', '/accounts')).json().items.map((a: { id: string }) => a.id),
    ).not.toContain(acc.id);
    expect(
      (
        await api('POST', '/transactions', {
          type: 'income',
          accountId: acc.id,
          amount: 100,
          date: '2026-10-02',
          description: 'X',
        })
      ).json().error.code,
    ).toBe('account_archived');
    const empty = await createAccount('Vazia');
    expect((await api('DELETE', `/accounts/${empty.id}`)).statusCode).toBe(204);
    expect((await api('GET', `/accounts/${empty.id}`)).statusCode).toBe(404);
  });

  it('manages categories with one level of subcategories', async () => {
    const list = (await api('GET', '/categories?kind=expense')).json().items;
    expect(list.length).toBeGreaterThan(10);
    expect(list.every((c: { isSystem: boolean }) => !c.isSystem)).toBe(true);
    const parent = await categoryId('Transporte');
    const sub = await api('POST', '/categories', {
      name: 'Combustível',
      kind: 'expense',
      parentId: parent,
    });
    expect(sub.statusCode).toBe(201);
    expect(
      (
        await api('POST', '/categories', {
          name: 'Gasolina',
          kind: 'expense',
          parentId: sub.json().id,
        })
      ).json().error.code,
    ).toBe('invalid_parent');
    expect(
      (await api('POST', '/categories', { name: 'Bônus', kind: 'income', parentId: parent })).json()
        .error.code,
    ).toBe('invalid_parent');

    expect((await api('DELETE', `/categories/${parent}`)).statusCode).toBe(204);
    const after = (await api('GET', '/categories')).json().items;
    expect(after.find((c: { id: string }) => c.id === sub.json().id).parentId).toBeNull();

    const system = (await api('GET', '/categories?includeSystem=true'))
      .json()
      .items.find((c: { systemKey: string | null }) => c.systemKey === 'transfer');
    expect((await api('DELETE', `/categories/${system.id}`)).statusCode).toBe(400);
    expect((await api('PATCH', `/categories/${system.id}`, { name: 'Transf.' })).statusCode).toBe(
      200,
    );
  });
});
