import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app';
import { createAuth } from '../../auth/auth';
import { createAdminInvite } from '../../cli/create-invite';
import { createTempDb, testDatabaseUrl } from '../../test/temp-db';

const appUrl = 'http://localhost:5174';

describe.skipIf(!testDatabaseUrl)('onboarding API (integration)', () => {
  let drop: () => Promise<void>;
  let app: ReturnType<typeof buildApp>;
  let cookie: string;

  const call = (method: 'GET' | 'PUT', path: string, payload?: unknown) =>
    app.inject({
      method,
      url: path,
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
    app = buildApp({ db: temp.db, auth, appUrl, today: () => '2026-10-15' });
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
  });

  afterAll(async () => {
    await app?.close();
    await drop?.();
  });

  it('starts visible, keeps skipped steps and can be dismissed', async () => {
    expect((await call('GET', '/api/me')).json().onboarding).toEqual({
      dismissed: false,
      skipped: [],
    });
    const skipped = await call('PUT', '/api/me/onboarding', { skipped: ['card', 'debts', 'card'] });
    expect(skipped.statusCode).toBe(200);
    expect(skipped.json()).toEqual({ dismissed: false, skipped: ['card', 'debts'] });
    // Só o que mudou: esconder mantém os passos pulados.
    await call('PUT', '/api/me/onboarding', { dismissed: true });
    expect((await call('GET', '/api/me')).json().onboarding).toEqual({
      dismissed: true,
      skipped: ['card', 'debts'],
    });
    expect((await call('PUT', '/api/me/onboarding', { skipped: ['nope'] })).statusCode).toBe(400);
  });
});
