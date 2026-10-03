import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app';
import { createAuth } from '../../auth/auth';
import { createAdminInvite } from '../../cli/create-invite';
import { createTempDb, testDatabaseUrl } from '../../test/temp-db';
import { createHmac } from 'node:crypto';

const appUrl = 'http://localhost:5174';
const TODAY = '2026-10-15';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** TOTP (RFC 6238, SHA-1, 6 dígitos, 30 s) a partir do segredo em base32 do `otpauth://`. */
function totp(base32: string, at = Date.now()): string {
  let bits = '';
  for (const ch of base32.replace(/=+$/, '').toUpperCase()) {
    bits += B32.indexOf(ch).toString(2).padStart(5, '0');
  }
  const bytes = Buffer.from((bits.match(/.{8}/g) ?? []).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const hmac = createHmac('sha1', bytes).update(counter).digest();
  const offset = (hmac[hmac.length - 1] ?? 0) & 0xf;
  const value = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(value).padStart(6, '0');
}

describe.skipIf(!testDatabaseUrl)('two-factor authentication (integration)', () => {
  let drop: () => Promise<void>;
  let app: ReturnType<typeof buildApp>;
  let cookie: string;
  let secret = '';

  const call = (method: 'GET' | 'POST', path: string, payload?: unknown, cookies = cookie) =>
    app.inject({
      method,
      url: path,
      headers: { cookie: cookies, origin: appUrl },
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });
  const cookiesOf = (res: { headers: Record<string, unknown> }) => {
    const raw = res.headers['set-cookie'];
    return (Array.isArray(raw) ? raw : [String(raw)])
      .map((c) => String(c).split(';')[0])
      .join('; ');
  };

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
    cookie = cookiesOf(res);
  });

  afterAll(async () => {
    await app?.close();
    await drop?.();
  });

  it('enables TOTP, then requires the code at sign-in and accepts a backup code once', async () => {
    expect((await call('GET', '/api/me')).json().twoFactorEnabled).toBe(false);

    const wrongPassword = await call('POST', '/api/auth/two-factor/enable', { password: 'errada' });
    expect(wrongPassword.statusCode).toBeGreaterThanOrEqual(400);

    const enabled = await call('POST', '/api/auth/two-factor/enable', {
      password: 'senha-forte-1',
    });
    expect(enabled.statusCode).toBe(200);
    const { totpURI, backupCodes } = enabled.json();
    expect(totpURI).toMatch(/^otpauth:\/\/totp\//);
    expect(backupCodes.length).toBeGreaterThanOrEqual(5);
    secret = new URL(totpURI).searchParams.get('secret') ?? '';

    // Antes de confirmar o primeiro código, o login continua sem segundo fator.
    expect(
      (await call('POST', '/api/auth/two-factor/verify-totp', { code: '000000' })).statusCode,
    ).toBeGreaterThanOrEqual(400);
    const confirm = await call('POST', '/api/auth/two-factor/verify-totp', { code: totp(secret) });
    expect(confirm.statusCode).toBe(200);
    cookie = cookiesOf(confirm) || cookie;
    expect((await call('GET', '/api/me')).json().twoFactorEnabled).toBe(true);

    // Novo login: senha certa NÃO basta.
    const signIn = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: { origin: appUrl },
      payload: { email: 'samuel@ex.com', password: 'senha-forte-1' },
    });
    expect(signIn.json().twoFactorRedirect).toBe(true);
    const pending = cookiesOf(signIn);
    expect((await call('GET', '/api/me', undefined, pending)).statusCode).toBe(401);

    const bad = await call('POST', '/api/auth/two-factor/verify-totp', { code: '123456' }, pending);
    expect(bad.statusCode).toBeGreaterThanOrEqual(400);
    const ok = await call(
      'POST',
      '/api/auth/two-factor/verify-totp',
      { code: totp(secret) },
      pending,
    );
    expect(ok.statusCode).toBe(200);
    expect((await call('GET', '/api/me', undefined, cookiesOf(ok))).statusCode).toBe(200);

    // Código de backup funciona uma vez.
    const second = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: { origin: appUrl },
      payload: { email: 'samuel@ex.com', password: 'senha-forte-1' },
    });
    const pending2 = cookiesOf(second);
    const withBackup = await call(
      'POST',
      '/api/auth/two-factor/verify-backup-code',
      { code: backupCodes[0] },
      pending2,
    );
    expect(withBackup.statusCode).toBe(200);
    const third = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: { origin: appUrl },
      payload: { email: 'samuel@ex.com', password: 'senha-forte-1' },
    });
    const reused = await call(
      'POST',
      '/api/auth/two-factor/verify-backup-code',
      { code: backupCodes[0] },
      cookiesOf(third),
    );
    expect(reused.statusCode).toBeGreaterThanOrEqual(400);
  });

  it('disables with the password and signs in with just the password again', async () => {
    const signIn = () =>
      app.inject({
        method: 'POST',
        url: '/api/auth/sign-in/email',
        headers: { origin: appUrl },
        payload: { email: 'samuel@ex.com', password: 'senha-forte-1' },
      });
    const first = await signIn();
    expect(first.json().twoFactorRedirect).toBe(true);
    const verified = await call(
      'POST',
      '/api/auth/two-factor/verify-totp',
      { code: totp(secret) },
      cookiesOf(first),
    );
    const session = cookiesOf(verified);

    const wrong = await call(
      'POST',
      '/api/auth/two-factor/disable',
      { password: 'errada' },
      session,
    );
    expect(wrong.statusCode).toBeGreaterThanOrEqual(400);
    const off = await call(
      'POST',
      '/api/auth/two-factor/disable',
      { password: 'senha-forte-1' },
      session,
    );
    expect(off.statusCode).toBe(200);
    const again = await signIn();
    expect(again.json().twoFactorRedirect).toBeUndefined();
    expect(
      (await call('GET', '/api/me', undefined, cookiesOf(again))).json().twoFactorEnabled,
    ).toBe(false);
  });
});
