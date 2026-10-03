import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app';
import { createAuth } from '../../auth/auth';
import { createAdminInvite } from '../../cli/create-invite';
import { sql } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { createTempDb, testDatabaseUrl } from '../../test/temp-db';

const appUrl = 'http://localhost:5174';
const TODAY = '2026-10-15';

describe.skipIf(!testDatabaseUrl)('shared spaces (integration)', () => {
  let drop: () => Promise<void>;
  let app: ReturnType<typeof buildApp>;
  let adminUrl: string;
  let ana: { cookie: string; personal: string; id: string };
  let bia: { cookie: string; personal: string; id: string };

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
  });

  afterAll(async () => {
    await app?.close();
    await drop?.();
  });

  let shared = '';

  it('creates a shared space with the creator as owner and default categories', async () => {
    const res = await call(ana, 'POST', '/api/spaces', { name: 'Casa' });
    expect(res.statusCode).toBe(201);
    shared = res.json().id;
    expect(res.json()).toMatchObject({ name: 'Casa', type: 'shared', role: 'owner' });
    const cats = (await call(ana, 'GET', `/api/spaces/${shared}/categories`)).json().items;
    expect(cats.length).toBeGreaterThan(5);
    expect((await call(ana, 'GET', '/api/me')).json().spaces).toHaveLength(2);
    expect((await call(bia, 'GET', `/api/spaces/${shared}/categories`)).statusCode).toBe(404);
  });

  it('never shares a personal space', async () => {
    const res = await call(ana, 'POST', '/api/invites', { spaceId: ana.personal });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('personal_space');
  });

  it('lets an existing user join with the invite code, once', async () => {
    const invite = (await call(ana, 'POST', '/api/invites', { spaceId: shared })).json();
    expect((await call(bia, 'POST', '/api/invites/accept', { code: 'XXXX-YYYY' })).statusCode).toBe(
      400,
    );
    const joined = await call(bia, 'POST', '/api/invites/accept', {
      code: invite.code.toLowerCase(),
    });
    expect(joined.statusCode).toBe(200);
    expect(joined.json()).toMatchObject({ id: shared, role: 'member' });
    expect((await call(bia, 'POST', '/api/invites/accept', { code: invite.code })).statusCode).toBe(
      400,
    );
    expect((await call(bia, 'GET', `/api/spaces/${shared}/categories`)).statusCode).toBe(200);
    // Convite de cadastro (sem espaço) não serve para entrar.
    const plain = (await call(ana, 'POST', '/api/invites', {})).json();
    expect((await call(bia, 'POST', '/api/invites/accept', { code: plain.code })).statusCode).toBe(
      400,
    );
  });

  it('restricts an invite to its e-mail', async () => {
    const invite = (
      await call(ana, 'POST', '/api/invites', { spaceId: shared, email: 'outra@ex.com' })
    ).json();
    const caio = await signUp('Caio', 'caio@ex.com');
    expect(
      (await call(caio, 'POST', '/api/invites/accept', { code: invite.code })).statusCode,
    ).toBe(400);
    expect((await call(caio, 'GET', `/api/spaces/${shared}/categories`)).statusCode).toBe(404);
  });

  it('lists members and enforces owner-only actions', async () => {
    const members = (await call(bia, 'GET', `/api/spaces/${shared}/members`)).json().items;
    expect(members.map((m: { name: string; role: string }) => [m.name, m.role])).toEqual([
      ['Ana', 'owner'],
      ['Bia', 'member'],
    ]);
    expect((await call(bia, 'PATCH', `/api/spaces/${shared}`, { name: 'Minha' })).statusCode).toBe(
      403,
    );
    expect((await call(bia, 'POST', '/api/invites', { spaceId: shared })).statusCode).toBe(403);
    expect((await call(bia, 'DELETE', `/api/spaces/${shared}/members/${ana.id}`)).statusCode).toBe(
      403,
    );
    expect((await call(ana, 'DELETE', `/api/spaces/${shared}/members/${ana.id}`)).statusCode).toBe(
      400,
    );
    expect(
      (await call(ana, 'PATCH', `/api/spaces/${shared}`, { name: 'Casa nova' })).json().name,
    ).toBe('Casa nova');
    expect(
      (await call(ana, 'PATCH', `/api/spaces/${ana.personal}`, { name: 'x' })).statusCode,
    ).toBe(400);
  });

  it('switches the active space only among your own', async () => {
    expect((await call(bia, 'PUT', '/api/me/active-space', { spaceId: shared })).statusCode).toBe(
      204,
    );
    expect((await call(bia, 'GET', '/api/me')).json().activeSpaceId).toBe(shared);
    expect(
      (await call(bia, 'PUT', '/api/me/active-space', { spaceId: ana.personal })).statusCode,
    ).toBe(404);
  });

  it('sums every space in the consolidated view and keeps personal data private', async () => {
    const account = async (who: typeof ana, space: string, balance: number) =>
      (
        await call(who, 'POST', `/api/spaces/${space}/accounts`, {
          name: 'Conta',
          type: 'checking',
          initialBalance: balance,
          initialDate: '2026-01-01',
        })
      ).json().id;
    await account(ana, ana.personal, 100000);
    await account(ana, shared, 50000);
    const view = (await call(ana, 'GET', '/api/consolidated')).json();
    expect(view.spaces).toHaveLength(2);
    expect(view.totals.balance).toBe(150000);
    // Bia vê só o compartilhado (o pessoal da Ana nunca aparece para ela).
    const biaView = (await call(bia, 'GET', '/api/consolidated')).json();
    expect(biaView.spaces.map((s: { type: string }) => s.type).sort()).toEqual([
      'personal',
      'shared',
    ]);
    expect(biaView.totals.balance).toBe(50000);
    const accounts = (await call(bia, 'GET', `/api/spaces/${ana.personal}/accounts`)).statusCode;
    expect(accounts).toBe(404);
  });

  it('removes a member and resets their active space', async () => {
    expect((await call(ana, 'DELETE', `/api/spaces/${shared}/members/${bia.id}`)).statusCode).toBe(
      204,
    );
    const me = (await call(bia, 'GET', '/api/me')).json();
    expect(me.spaces).toHaveLength(1);
    expect(me.activeSpaceId).toBe(bia.personal);
    expect((await call(bia, 'GET', `/api/spaces/${shared}/members`)).statusCode).toBe(404);
  });

  it('lets a member leave by themselves', async () => {
    const invite = (await call(ana, 'POST', '/api/invites', { spaceId: shared })).json();
    await call(bia, 'POST', '/api/invites/accept', { code: invite.code });
    expect((await call(bia, 'DELETE', `/api/spaces/${shared}/members/${bia.id}`)).statusCode).toBe(
      204,
    );
    expect((await call(bia, 'GET', `/api/spaces/${shared}/accounts`)).statusCode).toBe(404);
  });

  it('transfers ownership to a member, who can then rename; the old owner can leave', async () => {
    const invite = (await call(ana, 'POST', '/api/invites', { spaceId: shared })).json();
    await call(bia, 'POST', '/api/invites/accept', { code: invite.code });
    // Membro não passa a posse; dono não passa para si nem para quem não é membro.
    expect(
      (await call(bia, 'POST', `/api/spaces/${shared}/transfer`, { userId: bia.id })).statusCode,
    ).toBe(403);
    expect(
      (await call(ana, 'POST', `/api/spaces/${shared}/transfer`, { userId: ana.id })).json().error
        .code,
    ).toBe('already_owner');
    expect(
      (await call(ana, 'POST', `/api/spaces/${shared}/transfer`, { userId: crypto.randomUUID() }))
        .statusCode,
    ).toBe(404);
    expect(
      (await call(ana, 'POST', `/api/spaces/${ana.personal}/transfer`, { userId: bia.id }))
        .statusCode,
    ).toBe(400);
    // O dono não sai antes de passar a posse.
    expect(
      (await call(ana, 'DELETE', `/api/spaces/${shared}/members/${ana.id}`)).json().error.code,
    ).toBe('owner_cannot_leave');

    const res = await call(ana, 'POST', `/api/spaces/${shared}/transfer`, { userId: bia.id });
    expect(res.statusCode).toBe(200);
    const roles = (await call(bia, 'GET', `/api/spaces/${shared}/members`)).json().items;
    expect(roles.map((m: { name: string; role: string }) => [m.name, m.role])).toEqual([
      ['Ana', 'member'],
      ['Bia', 'owner'],
    ]);
    expect(
      (await call(bia, 'PATCH', `/api/spaces/${shared}`, { name: 'Casa nova' })).statusCode,
    ).toBe(200);
    expect((await call(ana, 'DELETE', `/api/spaces/${shared}/members/${ana.id}`)).statusCode).toBe(
      204,
    );
  });

  it('deletes a shared space after confirming the name, for every member', async () => {
    const space = (await call(bia, 'POST', '/api/spaces', { name: 'Viagem' })).json().id;
    const invite = (await call(bia, 'POST', '/api/invites', { spaceId: space })).json();
    await call(ana, 'POST', '/api/invites/accept', { code: invite.code });
    await call(ana, 'PUT', '/api/me/active-space', { spaceId: space });
    const pending = (await call(bia, 'POST', '/api/invites', { spaceId: space })).json();

    expect(
      (await call(ana, 'DELETE', `/api/spaces/${space}`, { confirmName: 'Viagem' })).statusCode,
    ).toBe(403);
    expect(
      (await call(bia, 'DELETE', `/api/spaces/${space}`, { confirmName: 'Outro' })).json().error
        .code,
    ).toBe('confirm_name');
    expect(
      (await call(bia, 'DELETE', `/api/spaces/${bia.personal}`, { confirmName: 'Pessoal' }))
        .statusCode,
    ).toBe(400);
    expect(
      (await call(bia, 'DELETE', `/api/spaces/${space}`, { confirmName: ' viagem ' })).statusCode,
    ).toBe(204);

    const anaMe = (await call(ana, 'GET', '/api/me')).json();
    expect(anaMe.spaces.some((s: { id: string }) => s.id === space)).toBe(false);
    expect(anaMe.activeSpaceId).toBe(ana.personal);
    expect((await call(bia, 'GET', `/api/spaces/${space}/accounts`)).statusCode).toBe(404);
    // Convite pendente do espaço excluído não funciona mais.
    const carla = await signUp('Carla', 'carla@ex.com');
    expect(
      (await call(carla, 'POST', '/api/invites/accept', { code: pending.code })).statusCode,
    ).toBe(400);
  });
});

describe.skipIf(!testDatabaseUrl)('invites management (integration)', () => {
  let drop: () => Promise<void>;
  let app: ReturnType<typeof buildApp>;
  let cookie: string;

  const call = (method: 'GET' | 'POST' | 'DELETE', path: string, payload?: unknown, c = cookie) =>
    app.inject({
      method,
      url: path,
      headers: { cookie: c, origin: appUrl },
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
        name: 'Ana',
        email: 'ana@ex.com',
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

  it('a new user signs up with an invite created in the app, which then cannot be reused', async () => {
    const invite = (await call('POST', '/api/invites', { email: 'novo@ex.com' })).json();
    const signUp = (email: string) =>
      app.inject({
        method: 'POST',
        url: '/api/auth/sign-up/email',
        headers: { origin: appUrl },
        payload: { name: 'Novo', email, password: 'senha-forte-1', inviteCode: invite.code },
      });
    expect((await signUp('outro@ex.com')).statusCode).toBeGreaterThanOrEqual(400);
    expect((await signUp('novo@ex.com')).statusCode).toBe(200);
    expect((await signUp('novo2@ex.com')).statusCode).toBeGreaterThanOrEqual(400);
    const list = (await call('GET', '/api/invites')).json().items;
    expect(list.find((i: { id: string }) => i.id === invite.id).usedAt).toBeTruthy();
  });

  it('revokes only your own unused invites', async () => {
    const invite = (await call('POST', '/api/invites', {})).json();
    expect((await call('DELETE', `/api/invites/${invite.id}`)).statusCode).toBe(204);
    expect((await call('DELETE', `/api/invites/${invite.id}`)).statusCode).toBe(404);
    const used = (await call('GET', '/api/invites'))
      .json()
      .items.find((i: { usedAt: string | null }) => i.usedAt);
    expect((await call('DELETE', `/api/invites/${used.id}`)).statusCode).toBe(404);
  });
});

describe.skipIf(!testDatabaseUrl)('account deletion (integration)', () => {
  let drop: () => Promise<void>;
  let app: ReturnType<typeof buildApp>;
  let db: Db;
  let adminUrl: string;
  type User = { cookie: string; id: string; personal: string; email: string };
  let ana: User;
  let bia: User;

  const call = (
    who: { cookie: string },
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    payload?: unknown,
  ) =>
    app.inject({
      method,
      url: path,
      headers: { cookie: who.cookie, origin: appUrl },
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });

  const signUp = async (name: string, email: string): Promise<User> => {
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
    return { cookie, id: me.user.id, personal: me.activeSpaceId, email };
  };
  const remove = (who: User, password = 'senha-forte-1', confirm = 'EXCLUIR') =>
    call(who, 'POST', '/api/me/delete', { password, confirm });
  const count = async (table: string, where: string) =>
    Number(
      (await db.execute(sql.raw(`select count(*)::int as n from ${table} where ${where}`))).rows[0]
        ?.n,
    );

  beforeAll(async () => {
    const temp = await createTempDb();
    drop = temp.drop;
    db = temp.db;
    adminUrl = temp.url;
    const auth = createAuth({
      db,
      secret: 'test-secret-test-secret-test-secret-00',
      appUrl,
      production: false,
    });
    app = buildApp({ db, auth, appUrl, today: () => TODAY });
    ana = await signUp('Ana', 'ana@ex.com');
    bia = await signUp('Bia', 'bia@ex.com');
  });

  afterAll(async () => {
    await app?.close();
    await drop?.();
  });

  it('asks for the password and the word EXCLUIR', async () => {
    expect((await remove(ana, 'errada')).statusCode).toBe(400);
    expect((await remove(ana, 'senha-forte-1', 'excluir')).statusCode).toBe(400);
    expect(
      (await call(ana, 'POST', '/api/auth/delete-user', { password: 'senha-forte-1' })).statusCode,
    ).toBe(404);
    expect((await call(ana, 'GET', '/api/me')).statusCode).toBe(200);
  });

  it('refuses while she owns a shared space with other members, then deletes everything', async () => {
    const acc = (
      await call(ana, 'POST', `/api/spaces/${ana.personal}/accounts`, {
        name: 'Conta',
        type: 'checking',
        initialBalance: 1000,
        initialDate: '2026-01-01',
      })
    ).json().id;
    await call(ana, 'POST', `/api/spaces/${ana.personal}/transactions`, {
      type: 'expense',
      status: 'settled',
      amount: 500,
      date: '2026-10-10',
      description: 'Pessoal',
      accountId: acc,
    });
    await call(ana, 'POST', `/api/spaces/${ana.personal}/goals`, {
      name: 'Meta',
      targetAmount: 1000,
      savedAmount: 100,
    });

    const shared = (await call(ana, 'POST', '/api/spaces', { name: 'Casa' })).json().id;
    const invite = (await call(ana, 'POST', '/api/invites', { spaceId: shared })).json();
    await call(bia, 'POST', '/api/invites/accept', { code: invite.code });
    const sharedAcc = (
      await call(bia, 'POST', `/api/spaces/${shared}/accounts`, {
        name: 'Casa',
        type: 'checking',
        initialBalance: 0,
        initialDate: '2026-01-01',
      })
    ).json().id;
    await call(ana, 'POST', `/api/spaces/${shared}/transactions`, {
      type: 'expense',
      status: 'settled',
      amount: 700,
      date: '2026-10-11',
      description: 'Mercado da casa',
      accountId: sharedAcc,
    });
    // Grupo de racha criado por Ana, com a Bia dentro.
    const group = (
      await call(ana, 'POST', '/api/split-groups', { name: 'Viagem', friends: ['Caio'] })
    ).json().id;
    const code = (await call(ana, 'GET', `/api/split-groups/${group}`)).json().joinCode;
    await call(bia, 'POST', '/api/split-groups/join', { code });
    // Grupo só da Ana (some junto).
    await call(ana, 'POST', '/api/split-groups', { name: 'Só minha' });

    const blocked = await remove(ana);
    expect(blocked.statusCode).toBe(400);
    expect(blocked.json().error.code).toBe('owns_shared_space');
    expect((await call(ana, 'GET', '/api/me')).statusCode).toBe(200);

    const members = (await call(ana, 'GET', `/api/spaces/${shared}/members`)).json().items;
    const biaMember = members.find((m: { email: string }) => m.email === bia.email);
    await call(ana, 'DELETE', `/api/spaces/${shared}/members/${biaMember.userId}`);

    expect((await remove(ana)).statusCode).toBe(204);
    // Sem sessão e sem login.
    expect((await call(ana, 'GET', '/api/me')).statusCode).toBe(401);
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: { origin: appUrl },
      payload: { email: ana.email, password: 'senha-forte-1' },
    });
    expect(login.statusCode).toBeGreaterThanOrEqual(400);

    expect(await count('users', `id = '${ana.id}'`)).toBe(0);
    expect(await count('spaces', `id in ('${ana.personal}', '${shared}')`)).toBe(0);
    expect(await count('transactions', `space_id = '${ana.personal}'`)).toBe(0);
    expect(await count('goals', `space_id = '${ana.personal}'`)).toBe(0);
    // O racha com a Bia continua, agora dela; o grupo só da Ana sumiu.
    expect(await count('split_groups', `name = 'Só minha'`)).toBe(0);
    const left = (await call(bia, 'GET', `/api/split-groups/${group}`)).json();
    expect(left.participants.map((p: { name: string }) => p.name).sort()).toEqual([
      'Ana',
      'Bia',
      'Caio',
    ]);
    expect(await count('split_groups', `id = '${group}' and created_by = '${bia.id}'`)).toBe(1);
    // Bia continua com tudo dela.
    expect((await call(bia, 'GET', '/api/me')).statusCode).toBe(200);
  });

  it('removes her membership but keeps the transactions in spaces owned by others', async () => {
    const caio = await signUp('Caio', 'caio@ex.com');
    const shared = (await call(bia, 'POST', '/api/spaces', { name: 'Família' })).json().id;
    const invite = (await call(bia, 'POST', '/api/invites', { spaceId: shared })).json();
    await call(caio, 'POST', '/api/invites/accept', { code: invite.code });
    const acc = (
      await call(bia, 'POST', `/api/spaces/${shared}/accounts`, {
        name: 'Conta',
        type: 'checking',
        initialBalance: 0,
        initialDate: '2026-01-01',
      })
    ).json().id;
    await call(caio, 'POST', `/api/spaces/${shared}/transactions`, {
      type: 'expense',
      status: 'settled',
      amount: 900,
      date: '2026-10-12',
      description: 'Do Caio',
      accountId: acc,
    });
    expect((await remove(caio)).statusCode).toBe(204);
    expect(await count('transactions', `description = 'Do Caio' and created_by is null`)).toBe(1);
    expect(await count('space_members', `space_id = '${shared}'`)).toBe(1);
  });
});
