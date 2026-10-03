import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app';
import { createAuth } from '../../auth/auth';
import { createAdminInvite } from '../../cli/create-invite';
import { createTempDb, testDatabaseUrl } from '../../test/temp-db';
import { hashPin, PinThrottle, verifyPin } from './pin';

const appUrl = 'http://localhost:5174';
const TODAY = '2026-10-15';

describe('PinThrottle', () => {
  it('locks after 5 failures and releases after the wait', () => {
    let now = 1_000_000;
    const t = new PinThrottle(5, 60_000, () => now);
    for (let i = 0; i < 4; i++) t.fail('u');
    expect(t.waitSeconds('u')).toBe(0);
    t.fail('u');
    expect(t.waitSeconds('u')).toBe(60);
    now += 61_000;
    expect(t.waitSeconds('u')).toBe(0);
    t.fail('u');
    expect(t.waitSeconds('u')).toBe(0);
    t.success('u');
  });
});

describe('hashPin', () => {
  it('verifies the right PIN only, with a random salt', async () => {
    const a = await hashPin('1234');
    const b = await hashPin('1234');
    expect(a).not.toBe(b);
    expect(await verifyPin('1234', a)).toBe(true);
    expect(await verifyPin('1235', a)).toBe(false);
    expect(await verifyPin('1234', 'lixo')).toBe(false);
  });
});

describe.skipIf(!testDatabaseUrl)('PIN lock API (integration)', () => {
  let drop: () => Promise<void>;
  let app: ReturnType<typeof buildApp>;
  let cookie: string;

  const call = (method: 'GET' | 'PUT' | 'POST' | 'DELETE', path: string, payload?: unknown) =>
    app.inject({
      method,
      url: path,
      headers: { cookie, origin: appUrl },
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });
  const me = async () => (await call('GET', '/api/me')).json();

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
  });

  afterAll(async () => {
    await app?.close();
    await drop?.();
  });

  it('sets, verifies, changes and removes the PIN', async () => {
    expect((await me()).pinEnabled).toBe(false);
    expect((await call('PUT', '/api/me/pin', { pin: 'abcd' })).statusCode).toBe(400);
    expect((await call('PUT', '/api/me/pin', { pin: '123' })).statusCode).toBe(400);
    expect((await call('PUT', '/api/me/pin', { pin: '1234' })).statusCode).toBe(204);
    expect((await me()).pinEnabled).toBe(true);

    expect((await call('POST', '/api/me/pin/verify', { pin: '1234' })).statusCode).toBe(204);
    const wrong = await call('POST', '/api/me/pin/verify', { pin: '9999' });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().error.code).toBe('pin_invalid');

    // Trocar exige o PIN atual.
    expect((await call('PUT', '/api/me/pin', { pin: '654321' })).statusCode).toBe(400);
    expect(
      (await call('PUT', '/api/me/pin', { pin: '654321', currentPin: '0000' })).statusCode,
    ).toBe(400);
    expect(
      (await call('PUT', '/api/me/pin', { pin: '654321', currentPin: '1234' })).statusCode,
    ).toBe(204);
    expect((await call('POST', '/api/me/pin/verify', { pin: '654321' })).statusCode).toBe(204);

    expect((await call('DELETE', '/api/me/pin', { pin: '1111' })).statusCode).toBe(400);
    expect((await call('DELETE', '/api/me/pin', { pin: '654321' })).statusCode).toBe(204);
    expect((await me()).pinEnabled).toBe(false);
  });

  it('blocks guessing after repeated failures', async () => {
    await call('PUT', '/api/me/pin', { pin: '1234' });
    for (let i = 0; i < 5; i++) await call('POST', '/api/me/pin/verify', { pin: '0000' });
    const locked = await call('POST', '/api/me/pin/verify', { pin: '1234' });
    expect(locked.statusCode).toBe(429);
    expect(locked.json().error.code).toBe('pin_locked');
  });
});
