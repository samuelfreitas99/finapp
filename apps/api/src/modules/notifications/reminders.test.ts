import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app';
import { createAuth } from '../../auth/auth';
import { createAdminInvite } from '../../cli/create-invite';
import type { Db } from '../../db/client';
import { createTempDb, testDatabaseUrl } from '../../test/temp-db';
import { notifyDueReminders } from './reminders';

const appUrl = 'http://localhost:5174';

describe.skipIf(!testDatabaseUrl)('reminders and checklist (integration)', () => {
  let drop: () => Promise<void>;
  let db: Db;
  let app: ReturnType<typeof buildApp>;
  let cookie: string;

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
    app = buildApp({ db, auth, appUrl });
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { origin: appUrl },
      payload: {
        name: 'S',
        email: 's@ex.com',
        password: 'senha-forte-1',
        inviteCode: await createAdminInvite(temp.url),
      },
    });
    const raw = res.headers['set-cookie'];
    cookie = (Array.isArray(raw) ? raw : [String(raw)]).map((c) => c.split(';')[0]).join('; ');
  });

  afterAll(async () => {
    await app?.close();
    await drop?.();
  });

  const call = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown) =>
    app.inject({
      method,
      url,
      headers: { cookie, origin: appUrl },
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });

  it('creates checklist items and reminders, notifies once and advances repeats', async () => {
    const item = (
      await call('POST', '/api/reminders', { title: 'Levar documentos ao banco' })
    ).json();
    expect(item).toMatchObject({ dueAt: null, done: false });
    const past = new Date(Date.now() - 60_000).toISOString();
    const rem = (
      await call('POST', '/api/reminders', { title: 'Pagar IPVA', dueAt: past, repeat: 'monthly' })
    ).json();

    expect(await notifyDueReminders(db)).toBe(1);
    expect(await notifyDueReminders(db)).toBe(0); // uma vez por horário
    const center = (await call('GET', '/api/notifications')).json();
    expect(center.items[0]).toMatchObject({
      type: 'reminder',
      title: 'Pagar IPVA',
      url: '/lembretes',
    });

    // Concluir um lembrete mensal: vai para o mês seguinte, não fica concluído.
    const done = (await call('PATCH', `/api/reminders/${rem.id}`, { done: true })).json();
    expect(done.done).toBe(false);
    expect(new Date(done.dueAt).getTime()).toBeGreaterThan(Date.now() + 20 * 86_400_000);
    // Item de checklist concluído aparece como feito.
    expect((await call('PATCH', `/api/reminders/${item.id}`, { done: true })).json().done).toBe(
      true,
    );
    const list = (await call('GET', '/api/reminders')).json().items;
    expect(list.map((r: { title: string }) => r.title)).toEqual([
      'Pagar IPVA',
      'Levar documentos ao banco',
    ]);
    expect((await call('DELETE', `/api/reminders/${item.id}`)).statusCode).toBe(204);
    expect((await call('POST', '/api/reminders', { title: '' })).statusCode).toBe(400);
  });
});
