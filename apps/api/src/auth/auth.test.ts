import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import { createAdminInvite } from '../cli/create-invite';
import type { Db } from '../db/client';
import { invites, spaceMembers, spaces } from '../db/schema';
import { createTempDb, one, testDatabaseUrl } from '../test/temp-db';
import { createAuth } from './auth';

const appUrl = 'http://localhost:5174';

describe.skipIf(!testDatabaseUrl)('auth with invites (integration)', () => {
  let db: Db;
  let url: string;
  let drop: () => Promise<void>;
  let app: ReturnType<typeof buildApp>;

  beforeAll(async () => {
    ({ db, url, drop } = await createTempDb());
    const auth = createAuth({
      db,
      secret: 'test-secret-test-secret-test-secret-00',
      appUrl,
      production: false,
    });
    app = buildApp({ db, auth, appUrl });
  });

  afterAll(async () => {
    await app?.close();
    await drop?.();
  });

  const signUp = (body: Record<string, unknown>) =>
    app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { origin: appUrl },
      payload: body,
    });

  const cookieOf = (res: { headers: Record<string, unknown> }) => {
    const raw = res.headers['set-cookie'];
    const list = Array.isArray(raw) ? raw : [String(raw)];
    return list.map((c: string) => c.split(';')[0]).join('; ');
  };

  it('refuses sign-up without a valid invite', async () => {
    const res = await signUp({ name: 'X', email: 'x@ex.com', password: 'senha-forte-1' });
    expect(res.statusCode).toBe(403);
    expect(
      (
        await signUp({
          name: 'X',
          email: 'x@ex.com',
          password: 'senha-forte-1',
          inviteCode: 'NOPE-NOPE',
        })
      ).statusCode,
    ).toBe(403);
  });

  it('signs up with an admin invite, creates the personal space and logs in', async () => {
    const code = await createAdminInvite(url);
    const res = await signUp({
      name: 'Samuel',
      email: 'samuel@ex.com',
      password: 'senha-forte-1',
      inviteCode: code.toLowerCase(),
    });
    expect(res.statusCode).toBe(200);
    const cookie = cookieOf(res);
    expect(cookie).toContain('better-auth.session_token');
    expect(String(res.headers['set-cookie'])).toMatch(/HttpOnly/i);

    const me = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie } });
    expect(me.statusCode).toBe(200);
    const body = me.json();
    expect(body.user.email).toBe('samuel@ex.com');
    expect(body.spaces).toHaveLength(1);
    expect(body.spaces[0]).toMatchObject({ name: 'Pessoal', type: 'personal', role: 'owner' });
    expect(body.activeSpaceId).toBe(body.spaces[0].id);

    const [invite] = await db.select().from(invites).where(eq(invites.code, code));
    expect(invite?.usedBy).toBe(body.user.id);

    // O mesmo convite não serve de novo.
    const again = await signUp({
      name: 'Outro',
      email: 'outro@ex.com',
      password: 'senha-forte-1',
      inviteCode: code,
    });
    expect(again.statusCode).toBe(403);
  });

  it('requires a session for /api/me and allows sign-in', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/me' })).statusCode).toBe(401);
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: { origin: appUrl },
      payload: { email: 'samuel@ex.com', password: 'senha-forte-1' },
    });
    expect(res.statusCode).toBe(200);
    const me = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { cookie: cookieOf(res) },
    });
    expect(me.statusCode).toBe(200);
    const wrong = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: { origin: appUrl },
      payload: { email: 'samuel@ex.com', password: 'errada-errada' },
    });
    expect(wrong.statusCode).toBe(401);
  });

  it('lets users create invites, including for a shared space they own', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: { origin: appUrl },
      payload: { email: 'samuel@ex.com', password: 'senha-forte-1' },
    });
    const cookie = cookieOf(login);
    const me = (await app.inject({ method: 'GET', url: '/api/me', headers: { cookie } })).json();

    const shared = one(
      await db
        .insert(spaces)
        .values({ name: 'Casa', type: 'shared', createdBy: me.user.id })
        .returning(),
    );
    await db.insert(spaceMembers).values({ spaceId: shared.id, userId: me.user.id, role: 'owner' });

    const created = await app.inject({
      method: 'POST',
      url: '/api/invites',
      headers: { cookie },
      payload: { spaceId: shared.id, email: 'ana@ex.com' },
    });
    expect(created.statusCode).toBe(201);
    const invite = created.json();
    expect(invite.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);

    const list = await app.inject({ method: 'GET', url: '/api/invites', headers: { cookie } });
    expect(list.json().items).toHaveLength(1);

    // E-mail diferente do convite: recusado.
    expect(
      (
        await signUp({
          name: 'Bia',
          email: 'bia@ex.com',
          password: 'senha-forte-1',
          inviteCode: invite.code,
        })
      ).statusCode,
    ).toBe(403);
    const ana = await signUp({
      name: 'Ana',
      email: 'ana@ex.com',
      password: 'senha-forte-1',
      inviteCode: invite.code,
    });
    expect(ana.statusCode).toBe(200);
    const anaMe = (
      await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: cookieOf(ana) } })
    ).json();
    expect(anaMe.spaces.map((s: { type: string }) => s.type).sort()).toEqual([
      'personal',
      'shared',
    ]);

    // Ana não é dona da Casa: não pode convidar para ela.
    const denied = await app.inject({
      method: 'POST',
      url: '/api/invites',
      headers: { cookie: cookieOf(ana) },
      payload: { spaceId: shared.id },
    });
    expect(denied.statusCode).toBe(403);
    const invalid = await app.inject({
      method: 'POST',
      url: '/api/invites',
      headers: { cookie },
      payload: { email: 'x' },
    });
    expect(invalid.statusCode).toBe(400);
  });
});
