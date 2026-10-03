import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app';
import { createAuth } from '../../auth/auth';
import { createAdminInvite } from '../../cli/create-invite';
import type { Db } from '../../db/client';
import { notifications } from '../../db/schema';
import { createTempDb, testDatabaseUrl } from '../../test/temp-db';
import type { PushPayload, PushSender } from './push';

const appUrl = 'http://localhost:5174';

describe.skipIf(!testDatabaseUrl)('push and notification settings (integration)', () => {
  let drop: () => Promise<void>;
  let db: Db;
  let app: ReturnType<typeof buildApp>;
  let noPush: ReturnType<typeof buildApp>;
  let cookie: string;
  let userId: string;
  const sent: { userId: string; payload: PushPayload }[] = [];

  const fakePush: PushSender = {
    publicKey: 'BFakePublicKey',
    send: async (uid, payload) => {
      sent.push({ userId: uid, payload });
      return 1;
    },
  };

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
    app = buildApp({ db, auth, appUrl, push: fakePush });
    noPush = buildApp({ db, auth, appUrl });
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
    userId = (await app.inject({ method: 'GET', url: '/api/me', headers: { cookie } })).json().user
      .id;
  });

  afterAll(async () => {
    await app?.close();
    await noPush?.close();
    await drop?.();
  });

  const call = (
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    payload?: unknown,
    a = app,
  ) =>
    a.inject({
      method,
      url,
      headers: { cookie, origin: appUrl },
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });

  it('exposes the VAPID key and stores subscriptions', async () => {
    expect((await call('GET', '/api/push/vapid-key')).json()).toEqual({
      publicKey: 'BFakePublicKey',
    });
    expect((await call('GET', '/api/push/vapid-key', undefined, noPush)).json().error.code).toBe(
      'push_disabled',
    );
    const sub = {
      endpoint: 'https://push.example.com/abc',
      keys: { p256dh: 'p256', auth: 'auth' },
    };
    expect((await call('POST', '/api/push/subscriptions', sub)).statusCode).toBe(201);
    expect((await call('POST', '/api/push/subscriptions', sub)).statusCode).toBe(201); // upsert
    const test = (await call('POST', '/api/push/test')).json();
    expect(test).toEqual({ sent: 1 });
    expect(sent.at(-1)).toMatchObject({ userId, payload: { tag: 'test' } });
    expect(
      (await call('DELETE', '/api/push/subscriptions', { endpoint: sub.endpoint })).statusCode,
    ).toBe(204);
    expect(
      (await call('POST', '/api/push/subscriptions', { endpoint: 'nope', keys: {} })).statusCode,
    ).toBe(400);
  });

  it('returns default settings and saves changes (RN 9)', async () => {
    const defaults = (await call('GET', '/api/notification-settings')).json();
    expect(defaults.quietStart).toBeNull();
    expect(defaults.types).toHaveLength(13);
    // Tudo ligado por padrão, menos os resumos (semanal e mensal), que o usuário liga.
    const off = defaults.types
      .filter((t: { enabled: boolean }) => !t.enabled)
      .map((t: { type: string }) => t.type);
    expect(off.sort()).toEqual(['monthly_summary', 'weekly_summary']);
    expect(defaults.types.every((t: { daysBefore: number }) => t.daysBefore === 3)).toBe(true);
    const updated = (
      await call('PATCH', '/api/notification-settings', {
        quietStart: '22:00',
        quietEnd: '07:00',
        types: [
          { type: 'due_soon', daysBefore: 5 },
          { type: 'card_limit', enabled: false },
        ],
      })
    ).json();
    expect(updated).toMatchObject({ quietStart: '22:00', quietEnd: '07:00' });
    expect(updated.types.find((t: { type: string }) => t.type === 'due_soon')).toMatchObject({
      daysBefore: 5,
      enabled: true,
    });
    expect(updated.types.find((t: { type: string }) => t.type === 'card_limit')).toMatchObject({
      enabled: false,
    });
    expect(
      (await call('PATCH', '/api/notification-settings', { quietStart: '25:00' })).statusCode,
    ).toBe(400);
  });

  it('lists notifications and marks them as read', async () => {
    await db.insert(notifications).values([
      {
        userId,
        type: 'due_soon',
        title: 'Vence amanhã',
        body: 'Internet R$ 119,90',
        dedupeKey: 'a',
      },
      { userId, type: 'overdue', title: 'Venceu', body: 'Luz', dedupeKey: 'b' },
    ]);
    const list = (await call('GET', '/api/notifications')).json();
    expect(list.unread).toBe(2);
    await call('POST', `/api/notifications/${list.items[0].id}/read`);
    expect((await call('GET', '/api/notifications')).json().unread).toBe(1);
    await call('POST', '/api/notifications/read-all');
    expect((await call('GET', '/api/notifications')).json().unread).toBe(0);
  });
});
