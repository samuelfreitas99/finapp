import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import { createAdminInvite } from '../cli/create-invite';
import { createResetLink } from '../cli/reset-link';
import type { MailMessage } from '../mail';
import { createTempDb, testDatabaseUrl } from '../test/temp-db';
import { createAuth } from './auth';

const appUrl = 'http://localhost:5174';

describe.skipIf(!testDatabaseUrl)('forgot password (integration)', () => {
  let drop: () => Promise<void>;
  let app: ReturnType<typeof buildApp>;
  let dbUrl: string;
  const sent: MailMessage[] = [];

  const post = (url: string, payload: Record<string, unknown>, cookie = '') =>
    app.inject({ method: 'POST', url, headers: { origin: appUrl, cookie }, payload });
  const signIn = (password: string) =>
    post('/api/auth/sign-in/email', { email: 'ana@ex.com', password });
  const cookieOf = (res: Awaited<ReturnType<typeof post>>) => {
    const raw = res.headers['set-cookie'];
    return (Array.isArray(raw) ? raw : [String(raw)]).map((c) => c.split(';')[0]).join('; ');
  };
  const tokenOf = (link: string) => new URL(link).searchParams.get('token') ?? '';

  beforeAll(async () => {
    const temp = await createTempDb();
    drop = temp.drop;
    dbUrl = temp.url;
    const auth = createAuth({
      db: temp.db,
      secret: 'test-secret-test-secret-test-secret-00',
      appUrl,
      production: false,
      mailer: async (m) => {
        sent.push(m);
      },
    });
    app = buildApp({ db: temp.db, auth, appUrl, passwordResetEmail: true });
    await post('/api/auth/sign-up/email', {
      name: 'Ana Souza',
      email: 'ana@ex.com',
      password: 'senha-antiga-1',
      inviteCode: await createAdminInvite(temp.url),
    });
  });

  afterAll(async () => {
    await app?.close();
    await drop?.();
  });

  it('tells the login screen that e-mail reset is on', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/auth-features' })).json()).toEqual({
      passwordResetEmail: true,
    });
  });

  it('e-mails a link to the app screen, resets once and ends other sessions', async () => {
    const oldSession = cookieOf(await signIn('senha-antiga-1'));
    expect(
      (await post('/api/auth/request-password-reset', { email: 'ana@ex.com' })).statusCode,
    ).toBe(200);
    // E-mail desconhecido responde igual e não envia nada.
    expect((await post('/api/auth/request-password-reset', { email: 'x@ex.com' })).statusCode).toBe(
      200,
    );
    expect(sent).toHaveLength(1);
    const mail = sent[0] as MailMessage;
    expect(mail.to).toBe('ana@ex.com');
    expect(mail.text).toMatch(/^Olá, Ana\./);
    const link = /http\S+/.exec(mail.text)?.[0] ?? '';
    expect(link.startsWith(`${appUrl}/redefinir-senha?token=`)).toBe(true);

    const reset = await post('/api/auth/reset-password', {
      token: tokenOf(link),
      newPassword: 'senha-nova-123',
    });
    expect(reset.statusCode).toBe(200);
    expect((await signIn('senha-antiga-1')).statusCode).toBe(401);
    expect((await signIn('senha-nova-123')).statusCode).toBe(200);
    const me = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: oldSession } });
    expect(me.statusCode).toBe(401);
    // O mesmo link não vale duas vezes.
    expect(
      (
        await post('/api/auth/reset-password', {
          token: tokenOf(link),
          newPassword: 'outra-senha-9',
        })
      ).statusCode,
    ).toBe(400);
  });

  it('creates a 24 h link from the server for when there is no e-mail', async () => {
    expect(await createResetLink(dbUrl, appUrl, 'ninguem@ex.com')).toBeNull();
    const link = await createResetLink(dbUrl, appUrl, ' ANA@ex.com ');
    expect(link).toMatch(/\/redefinir-senha\?token=/);
    const res = await post('/api/auth/reset-password', {
      token: tokenOf(link ?? ''),
      newPassword: 'pelo-servidor-1',
    });
    expect(res.statusCode).toBe(200);
    expect((await signIn('pelo-servidor-1')).statusCode).toBe(200);
  });
});
