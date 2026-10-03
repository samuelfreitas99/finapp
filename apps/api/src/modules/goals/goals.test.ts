import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app';
import { createAuth } from '../../auth/auth';
import { createAdminInvite } from '../../cli/create-invite';
import { createTempDb, testDatabaseUrl } from '../../test/temp-db';

const appUrl = 'http://localhost:5174';
const TODAY = '2026-10-15';

describe.skipIf(!testDatabaseUrl)('goals API (integration)', () => {
  let drop: () => Promise<void>;
  let app: ReturnType<typeof buildApp>;
  let cookie: string;
  let spaceId: string;

  type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';
  const api = (method: Method, path: string, payload?: unknown) =>
    app.inject({
      method,
      url: `/api/spaces/${spaceId}${path}`,
      headers: { cookie, origin: appUrl },
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });

  beforeAll(async () => {
    const temp = await createTempDb();
    drop = temp.drop;
    const auth = createAuth({
      db: temp.db,
      secret: 'test-secret-test-secret-test-secret-00',
      appUrl,
      production: false,
    });
    app = buildApp({ db: temp.db, auth, appUrl, today: () => TODAY });
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
  });

  afterAll(async () => {
    await app?.close();
    await drop?.();
  });

  it('tracks a manual goal with deposits, withdrawals and a suggested monthly amount', async () => {
    const created = await api('POST', '/goals', {
      name: 'Viagem',
      targetAmount: 1200000,
      targetDate: '2027-10-20',
      savedAmount: 200000,
    });
    expect(created.statusCode).toBe(201);
    const goal = created.json();
    expect(goal).toMatchObject({
      saved: 200000,
      remaining: 1000000,
      monthsLeft: 12,
      suggestedMonthly: 83334,
      status: 'on_track',
    });

    const after = (await api('POST', `/goals/${goal.id}/deposit`, { amount: 100000 })).json();
    expect(after).toMatchObject({ saved: 300000, suggestedMonthly: 75000 });
    const less = await api('POST', `/goals/${goal.id}/deposit`, { amount: -999999 });
    expect(less.statusCode).toBe(400);
    expect((await api('POST', `/goals/${goal.id}/deposit`, { amount: 0 })).statusCode).toBe(400);
  });

  it('uses the linked account balance as saved and refuses manual deposits', async () => {
    const account = (
      await api('POST', '/accounts', {
        name: 'Reserva',
        type: 'savings',
        initialBalance: 500000,
        initialDate: '2026-01-01',
      })
    ).json();
    const goal = (
      await api('POST', '/goals', {
        name: 'Reserva de emergência',
        targetAmount: 500000,
        accountId: account.id,
      })
    ).json();
    expect(goal).toMatchObject({ saved: 500000, status: 'done', accountName: 'Reserva' });
    expect((await api('POST', `/goals/${goal.id}/deposit`, { amount: 1000 })).statusCode).toBe(400);
    expect(
      (
        await api('POST', '/goals', {
          name: 'X',
          targetAmount: 1000,
          accountId: crypto.randomUUID(),
        })
      ).statusCode,
    ).toBe(404);
  });

  it('edits, archives, lists and removes', async () => {
    const list = (await api('GET', '/goals')).json().items as { id: string; name: string }[];
    const trip = list.find((g) => g.name === 'Viagem');
    if (!trip) throw new Error('meta não encontrada');
    const edited = (
      await api('PATCH', `/goals/${trip.id}`, { targetAmount: 600000, targetDate: null })
    ).json();
    expect(edited).toMatchObject({ targetAmount: 600000, status: 'no_date' });
    expect(edited.suggestedMonthly).toBeNull();
    const archived = (await api('PATCH', `/goals/${trip.id}`, { archived: true })).json();
    expect(archived.archived).toBe(true);
    expect((await api('DELETE', `/goals/${trip.id}`)).statusCode).toBe(204);
    expect(
      (await api('GET', `/goals`)).json().items.map((g: { id: string }) => g.id),
    ).not.toContain(trip.id);
    expect((await api('DELETE', `/goals/${trip.id}`)).statusCode).toBe(404);
  });
});
