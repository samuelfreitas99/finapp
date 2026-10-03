import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app';
import { createAuth } from '../../auth/auth';
import { createAdminInvite } from '../../cli/create-invite';
import { createTempDb, testDatabaseUrl } from '../../test/temp-db';

const appUrl = 'http://localhost:5174';
const TODAY = '2026-10-15';

describe.skipIf(!testDatabaseUrl)('passkeys (integration)', () => {
  let drop: () => Promise<void>;
  let app: ReturnType<typeof buildApp>;
  let auth: ReturnType<typeof createAuth>;
  let cookie: string;

  const call = (method: 'GET' | 'POST', path: string, payload?: unknown, cookies = cookie) =>
    app.inject({
      method,
      url: path,
      headers: { cookie: cookies, origin: appUrl },
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });

  beforeAll(async () => {
    const temp = await createTempDb();
    drop = temp.drop;
    auth = createAuth({
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
    cookie = (Array.isArray(raw) ? raw : [String(raw)])
      .map((c) => String(c).split(';')[0])
      .join('; ');
  });

  afterAll(async () => {
    await app?.close();
    await drop?.();
  });

  it('offers registration options bound to the app domain, only to a signed-in user', async () => {
    const anonymous = await call(
      'GET',
      '/api/auth/passkey/generate-register-options',
      undefined,
      '',
    );
    expect(anonymous.statusCode).toBe(401);
    const res = await call('GET', '/api/auth/passkey/generate-register-options');
    expect(res.statusCode).toBe(200);
    const options = res.json();
    expect(options.rp).toMatchObject({ id: 'localhost', name: 'FinApp' });
    expect(options.challenge).toBeTruthy();
    expect(options.user.name).toBe('samuel@ex.com');
  });

  it('offers sign-in options without a session and starts with no passkeys', async () => {
    const res = await call('GET', '/api/auth/passkey/generate-authenticate-options', undefined, '');
    expect(res.statusCode).toBe(200);
    expect(res.json().challenge).toBeTruthy();
    const list = await call('GET', '/api/auth/passkey/list-user-passkeys');
    expect(list.json()).toEqual([]);
    const missing = await call('POST', '/api/auth/passkey/delete-passkey', {
      id: crypto.randomUUID(),
    });
    expect(missing.statusCode).toBeGreaterThanOrEqual(400);
  });

  it('lists and deletes a stored passkey (schema mapping)', async () => {
    const ctx = await auth.$context;
    const userId = (await call('GET', '/api/me')).json().user.id;
    const stored = await ctx.adapter.create<{ id: string }>({
      model: 'passkey',
      data: {
        name: 'Meu celular',
        publicKey: 'chave',
        userId,
        credentialID: 'cred-1',
        counter: 0,
        deviceType: 'multiDevice',
        backedUp: true,
        transports: 'internal',
        createdAt: new Date(),
      },
    });
    const list = (await call('GET', '/api/auth/passkey/list-user-passkeys')).json();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: 'Meu celular', credentialID: 'cred-1', backedUp: true });
    const del = await call('POST', '/api/auth/passkey/delete-passkey', { id: stored.id });
    expect(del.statusCode).toBe(200);
    expect((await call('GET', '/api/auth/passkey/list-user-passkeys')).json()).toEqual([]);
  });

  it('rejects a forged sign-in response', async () => {
    const res = await call(
      'POST',
      '/api/auth/passkey/verify-authentication',
      {
        response: {
          id: 'x',
          rawId: 'x',
          type: 'public-key',
          response: {},
          clientExtensionResults: {},
        },
      },
      '',
    );
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.headers['set-cookie']).toBeUndefined();
  });
});
