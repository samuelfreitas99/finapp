import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app';
import { createAuth } from '../../auth/auth';
import { createAdminInvite } from '../../cli/create-invite';
import { createTempDb, testDatabaseUrl } from '../../test/temp-db';

const appUrl = 'http://localhost:5174';
const TODAY = '2026-10-15';

describe.skipIf(!testDatabaseUrl)('couple split (integration)', () => {
  let drop: () => Promise<void>;
  let app: ReturnType<typeof buildApp>;
  let adminUrl: string;
  let ana: { cookie: string; personal: string; id: string };
  let bia: { cookie: string; personal: string; id: string };
  let shared = '';
  let accountId = '';

  const call = (
    who: { cookie: string },
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    payload?: unknown,
  ) =>
    app.inject({
      method,
      url: path,
      headers: { cookie: who.cookie, origin: appUrl },
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });
  const inSpace = (path: string) => `/api/spaces/${shared}${path}`;

  const signUp = async (name: string, email: string) => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { origin: appUrl },
      payload: {
        name,
        email,
        password: 'senha-forte-1',
        inviteCode: await createAdminInvite(adminUrl),
      },
    });
    const raw = res.headers['set-cookie'];
    const cookie = (Array.isArray(raw) ? raw : [String(raw)])
      .map((c) => String(c).split(';')[0])
      .join('; ');
    const me = (await call({ cookie }, 'GET', '/api/me')).json();
    return { cookie, personal: me.activeSpaceId as string, id: me.user.id as string };
  };

  const expense = async (amount: number, extra: Record<string, unknown> = {}) =>
    (
      await call(ana, 'POST', inSpace('/transactions'), {
        type: 'expense',
        status: 'settled',
        amount,
        date: '2026-10-10',
        description: 'Mercado',
        accountId,
        ...extra,
      })
    ).json().id as string;

  const balanceOf = async (who: typeof ana) => {
    const b = (await call(who, 'GET', inSpace('/couple/balance'))).json();
    return b as {
      members: { userId: string; balance: number }[];
      transfers: { fromUserId: string; toUserId: string; amount: number }[];
      settlements: { id: string }[];
      staleCount: number;
    };
  };
  const bal = (b: Awaited<ReturnType<typeof balanceOf>>, id: string) =>
    b.members.find((m) => m.userId === id)?.balance;

  beforeAll(async () => {
    const temp = await createTempDb();
    drop = temp.drop;
    adminUrl = temp.url;
    const auth = createAuth({
      db: temp.db,
      secret: 'test-secret-test-secret-test-secret-00',
      appUrl,
      production: false,
    });
    app = buildApp({ db: temp.db, auth, appUrl, today: () => TODAY });
    ana = await signUp('Ana', 'ana@ex.com');
    bia = await signUp('Bia', 'bia@ex.com');
    shared = (await call(ana, 'POST', '/api/spaces', { name: 'Casa' })).json().id;
    const invite = (await call(ana, 'POST', '/api/invites', { spaceId: shared })).json();
    await call(bia, 'POST', '/api/invites/accept', { code: invite.code });
    accountId = (
      await call(ana, 'POST', inSpace('/accounts'), {
        name: 'Conta da casa',
        type: 'checking',
        initialBalance: 1000000,
        initialDate: '2026-01-01',
      })
    ).json().id;
  });

  afterAll(async () => {
    await app?.close();
    await drop?.();
  });

  it('splits equally and Bia owes Ana her half', async () => {
    const id = await expense(10000);
    const put = await call(ana, 'PUT', inSpace(`/transactions/${id}/split`), {
      mode: 'equal',
      paidByUserId: ana.id,
    });
    expect(put.statusCode).toBe(204);
    const b = await balanceOf(bia);
    expect(bal(b, ana.id)).toBe(5000);
    expect(bal(b, bia.id)).toBe(-5000);
    expect(b.transfers).toEqual([{ fromUserId: bia.id, toUserId: ana.id, amount: 5000 }]);
    const split = (await call(bia, 'GET', inSpace(`/transactions/${id}/split`))).json();
    expect(split.paidByUserId).toBe(ana.id);
    expect(split.shares.map((s: { amount: number }) => s.amount)).toEqual([5000, 5000]);
  });

  it('gives the rounding remainder to who paid', async () => {
    const id = await expense(10001);
    await call(bia, 'PUT', inSpace(`/transactions/${id}/split`), {
      mode: 'equal',
      paidByUserId: bia.id,
    });
    const split = (await call(bia, 'GET', inSpace(`/transactions/${id}/split`))).json();
    const byUser = Object.fromEntries(
      split.shares.map((s: { userId: string; amount: number }) => [s.userId, s.amount]),
    );
    expect(byUser[bia.id]).toBe(5001);
    expect(byUser[ana.id]).toBe(5000);
    await call(ana, 'PUT', inSpace(`/transactions/${id}/split`), { mode: 'none' });
  });

  it('supports percent and amount splits and validates them', async () => {
    const id = await expense(20000);
    const url = inSpace(`/transactions/${id}/split`);
    expect(
      (
        await call(ana, 'PUT', url, {
          mode: 'percent',
          paidByUserId: ana.id,
          parts: [
            { userId: ana.id, percent: 50 },
            { userId: bia.id, percent: 40 },
          ],
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await call(ana, 'PUT', url, {
          mode: 'percent',
          paidByUserId: ana.id,
          parts: [
            { userId: ana.id, percent: 60 },
            { userId: bia.id, percent: 40 },
          ],
        })
      ).statusCode,
    ).toBe(204);
    expect(
      (
        await call(ana, 'PUT', url, {
          mode: 'amount',
          paidByUserId: ana.id,
          parts: [{ userId: bia.id, amount: 999 }],
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await call(ana, 'PUT', url, { mode: 'equal', paidByUserId: crypto.randomUUID() }))
        .statusCode,
    ).toBe(400);
    await call(ana, 'PUT', url, { mode: 'none' });
  });

  it('ignores planned expenses and deleted ones in the balance', async () => {
    const before = bal(await balanceOf(ana), ana.id);
    const planned = await expense(30000, { status: 'planned' });
    await call(ana, 'PUT', inSpace(`/transactions/${planned}/split`), {
      mode: 'equal',
      paidByUserId: ana.id,
    });
    expect(bal(await balanceOf(ana), ana.id)).toBe(before);

    const done = await expense(30000);
    await call(ana, 'PUT', inSpace(`/transactions/${done}/split`), {
      mode: 'equal',
      paidByUserId: ana.id,
    });
    expect(bal(await balanceOf(ana), ana.id)).toBe((before ?? 0) + 15000);
    await call(ana, 'DELETE', inSpace(`/transactions/${done}`));
    expect(bal(await balanceOf(ana), ana.id)).toBe(before);
  });

  it('flags splits whose amount changed afterwards', async () => {
    const id = await expense(8000);
    await call(ana, 'PUT', inSpace(`/transactions/${id}/split`), {
      mode: 'equal',
      paidByUserId: ana.id,
    });
    expect((await balanceOf(ana)).staleCount).toBe(0);
    await call(ana, 'PATCH', inSpace(`/transactions/${id}`), { amount: 9000 });
    expect((await balanceOf(ana)).staleCount).toBe(1);
    await call(ana, 'PUT', inSpace(`/transactions/${id}/split`), { mode: 'none' });
    expect((await balanceOf(ana)).staleCount).toBe(0);
  });

  it('settles the balance with a payment and allows undoing it', async () => {
    const before = await balanceOf(bia);
    const owed = -(bal(before, bia.id) ?? 0);
    expect(owed).toBeGreaterThan(0);
    const res = await call(bia, 'POST', inSpace('/couple/settlements'), {
      toUserId: ana.id,
      amount: owed,
      notes: 'Pix',
    });
    expect(res.statusCode).toBe(201);
    const after = await balanceOf(ana);
    expect(bal(after, bia.id)).toBe(0);
    expect(after.transfers).toEqual([]);
    expect(after.settlements).toHaveLength(1);
    expect(
      (await call(ana, 'DELETE', inSpace(`/couple/settlements/${res.json().id}`))).statusCode,
    ).toBe(204);
    expect(bal(await balanceOf(ana), bia.id)).toBe(-owed);
    expect(
      (await call(ana, 'POST', inSpace('/couple/settlements'), { toUserId: ana.id, amount: 1 }))
        .statusCode,
    ).toBe(400);
  });

  it('keeps the default split owner-only and rejects personal spaces', async () => {
    expect((await call(bia, 'PUT', inSpace('/split-settings'), { mode: 'equal' })).statusCode).toBe(
      403,
    );
    expect(
      (
        await call(ana, 'PUT', inSpace('/split-settings'), {
          mode: 'percent',
          percents: { [ana.id]: 70, [bia.id]: 20 },
        })
      ).statusCode,
    ).toBe(400);
    const ok = await call(ana, 'PUT', inSpace('/split-settings'), {
      mode: 'percent',
      percents: { [ana.id]: 60, [bia.id]: 40 },
    });
    expect(ok.json()).toMatchObject({ mode: 'percent', percents: { [ana.id]: 60, [bia.id]: 40 } });
    expect((await call(bia, 'GET', inSpace('/split-settings'))).json().mode).toBe('percent');
    const personal = await call(ana, 'GET', `/api/spaces/${ana.personal}/couple/balance`);
    expect(personal.statusCode).toBe(400);
    expect(personal.json().error.code).toBe('not_shared_space');
  });
});
