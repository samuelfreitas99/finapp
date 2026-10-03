import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app';
import { createAuth } from '../../auth/auth';
import { createAdminInvite } from '../../cli/create-invite';
import { createTempDb, testDatabaseUrl } from '../../test/temp-db';

const appUrl = 'http://localhost:5174';
const TODAY = '2026-10-15';

describe.skipIf(!testDatabaseUrl)('racha (integration)', () => {
  let drop: () => Promise<void>;
  let app: ReturnType<typeof buildApp>;
  let adminUrl: string;
  type User = { cookie: string; id: string };
  let ana: User;
  let bia: User;
  let caio: User;
  let outsider: User;
  let group = '';
  let anaP = '';
  let biaP = '';
  let caioP = '';

  const call = (
    who: User,
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
  const g = (path = '') => `/api/split-groups/${group}${path}`;

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
    const me = (await call({ cookie, id: '' }, 'GET', '/api/me')).json();
    return { cookie, id: me.user.id };
  };

  const expense = (payers: [string, number][], shares: unknown[], mode: string, amount: number) =>
    call(ana, 'POST', g('/expenses'), {
      description: 'Despesa',
      amount,
      date: '2026-10-10',
      mode,
      payers: payers.map(([participantId, a]) => ({ participantId, amount: a })),
      shares,
    });
  const balances = async (who: User = ana) => {
    const b = (await call(who, 'GET', g('/balances?simplify=true'))).json() as {
      balances: { participantId: string; balance: number }[];
      transfers: { fromParticipantId: string; toParticipantId: string; amount: number }[];
    };
    return {
      by: Object.fromEntries(b.balances.map((x) => [x.participantId, x.balance])),
      transfers: b.transfers,
    };
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
    caio = await signUp('Caio', 'caio@ex.com');
    const created = await call(ana, 'POST', '/api/split-groups', {
      name: 'Viagem',
      friends: ['Dani'],
    });
    expect(created.statusCode).toBe(201);
    group = created.json().id;
  });

  afterAll(async () => {
    await app?.close();
    await drop?.();
  });

  it('creates the group with the creator and a friend without account', async () => {
    const detail = (await call(ana, 'GET', g())).json();
    expect(
      detail.participants.map((p: { name: string; isMe: boolean }) => [p.name, p.isMe]),
    ).toEqual([
      ['Ana', true],
      ['Dani', false],
    ]);
    anaP = detail.participants[0].id;
    expect(detail.joinCode).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect((await call(bia, 'GET', g())).statusCode).toBe(404);
  });

  it('lets friends join with the code: new, or claiming a name', async () => {
    const code = (await call(ana, 'GET', g())).json().joinCode as string;
    const info = (await call(bia, 'GET', `/api/split-groups/join/${code}`)).json();
    expect(info.name).toBe('Viagem');
    expect(info.unclaimed.map((p: { name: string }) => p.name)).toEqual(['Dani']);
    expect(
      (await call(bia, 'POST', '/api/split-groups/join', { code: 'ZZZZ-ZZZZ' })).statusCode,
    ).toBe(400);
    expect(
      (await call(bia, 'POST', '/api/split-groups/join', { code: code.toLowerCase() })).statusCode,
    ).toBe(200);
    const danis = info.unclaimed[0].id as string;
    expect(
      (await call(caio, 'POST', '/api/split-groups/join', { code, participantId: danis }))
        .statusCode,
    ).toBe(200);
    // O nome já tem dono agora.
    outsider = await signUp('Dave', 'dave@ex.com');
    expect(
      (await call(outsider, 'POST', '/api/split-groups/join', { code, participantId: danis }))
        .statusCode,
    ).toBe(400);
    const people = (await call(ana, 'GET', g())).json().participants as {
      id: string;
      name: string;
      userId: string;
    }[];
    biaP = people.find((p) => p.userId === bia.id)?.id ?? '';
    caioP = danis;
    expect(people.find((p) => p.id === danis)?.userId).toBe(caio.id);
    expect((await call(bia, 'GET', g())).statusCode).toBe(200);
  });

  it('splits equally and the payer gets the rounding remainder', async () => {
    const res = await expense(
      [[anaP, 10000]],
      [{ participantId: anaP }, { participantId: biaP }, { participantId: caioP }],
      'equal',
      10000,
    );
    expect(res.statusCode).toBe(201);
    const { by } = await balances();
    // 10000 / 3 = 3333 cada; o resto (1) fica com quem pagou.
    expect(by[anaP]).toBe(10000 - 3334);
    expect(by[biaP]).toBe(-3333);
    expect(by[caioP]).toBe(-3333);
    expect(Object.values(by).reduce((a, b) => a + b, 0)).toBe(0);
  });

  it('supports percent, shares and amount modes, and several payers', async () => {
    const pct = await expense(
      [[biaP, 20000]],
      [
        { participantId: anaP, percent: 50 },
        { participantId: biaP, percent: 30 },
        { participantId: caioP, percent: 20 },
      ],
      'percent',
      20000,
    );
    expect(pct.statusCode).toBe(201);
    const shares = await expense(
      [[anaP, 6000]],
      [
        { participantId: anaP, weight: 1 },
        { participantId: biaP, weight: 2 },
      ],
      'shares',
      6000,
    );
    expect(shares.statusCode).toBe(201);
    const multi = await expense(
      [
        [anaP, 4000],
        [biaP, 6000],
      ],
      [
        { participantId: anaP, amount: 7000 },
        { participantId: caioP, amount: 3000 },
      ],
      'amount',
      10000,
    );
    expect(multi.statusCode).toBe(201);
    const { by } = await balances();
    expect(Object.values(by).reduce((a, b) => a + b, 0)).toBe(0);
    const detail = (await call(ana, 'GET', g())).json();
    expect(detail.expenses).toHaveLength(4);
  });

  it('validates the expense', async () => {
    const people = [{ participantId: anaP }, { participantId: biaP }];
    expect((await expense([[anaP, 900]], people, 'equal', 1000)).json().error.code).toBe(
      'payers_mismatch',
    );
    expect(
      (
        await expense(
          [[anaP, 1000]],
          [
            { participantId: anaP, percent: 60 },
            { participantId: biaP, percent: 30 },
          ],
          'percent',
          1000,
        )
      ).json().error.code,
    ).toBe('invalid_split');
    expect(
      (
        await expense(
          [[anaP, 1000]],
          [
            { participantId: anaP, amount: 100 },
            { participantId: biaP, amount: 100 },
          ],
          'amount',
          1000,
        )
      ).json().error.code,
    ).toBe('invalid_split');
    expect(
      (
        await expense([[anaP, 1000]], [{ participantId: crypto.randomUUID() }], 'equal', 1000)
      ).json().error.code,
    ).toBe('invalid_participant');
  });

  it('edits and deletes expenses, changing balances', async () => {
    const created = await expense(
      [[anaP, 3000]],
      [{ participantId: anaP }, { participantId: biaP }, { participantId: caioP }],
      'equal',
      3000,
    );
    const id = created.json().id;
    const before = (await balances()).by[anaP] ?? 0;
    const put = await call(bia, 'PUT', g(`/expenses/${id}`), {
      description: 'Editada',
      amount: 6000,
      date: '2026-10-11',
      mode: 'equal',
      payers: [{ participantId: anaP, amount: 6000 }],
      shares: [{ participantId: anaP }, { participantId: biaP }, { participantId: caioP }],
    });
    expect(put.statusCode).toBe(204);
    expect((await balances()).by[anaP]).toBe(before + 2000);
    expect((await call(ana, 'DELETE', g(`/expenses/${id}`))).statusCode).toBe(204);
    expect((await balances()).by[anaP]).toBe(before - 2000);
    expect((await call(ana, 'DELETE', g(`/expenses/${id}`))).statusCode).toBe(404);
  });

  it('simplifies debts and settles up', async () => {
    const { by, transfers } = await balances();
    expect(transfers.length).toBeLessThanOrEqual(2);
    const owed: Record<string, number> = {};
    for (const t of transfers)
      owed[t.fromParticipantId] = (owed[t.fromParticipantId] ?? 0) + t.amount;
    for (const [id, v] of Object.entries(by)) if (v < 0) expect(owed[id]).toBe(-v);
    // Sem simplificar: só saldos.
    const raw = (await call(ana, 'GET', g('/balances?simplify=false'))).json();
    expect(raw.transfers).toEqual([]);

    for (const t of transfers) {
      const res = await call(ana, 'POST', g('/settlements'), { ...t, method: 'Pix' });
      expect(res.statusCode).toBe(201);
    }
    const after = await balances();
    expect(Object.values(after.by).every((v) => v === 0)).toBe(true);
    expect(after.transfers).toEqual([]);
    const settlements = (await call(ana, 'GET', g())).json().settlements;
    expect(settlements.length).toBe(transfers.length);
    expect((await call(ana, 'DELETE', g(`/settlements/${settlements[0].id}`))).statusCode).toBe(
      204,
    );
    expect((await balances()).transfers.length).toBe(1);
    expect(
      (
        await call(ana, 'POST', g('/settlements'), {
          fromParticipantId: anaP,
          toParticipantId: anaP,
          amount: 1,
        })
      ).statusCode,
    ).toBe(400);
  });

  it('shows each member their own balance in the list', async () => {
    const list = (await call(bia, 'GET', '/api/split-groups')).json().items;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: 'Viagem', participantCount: 3 });
    expect(typeof list[0].myBalance).toBe('number');
    expect((await call(outsider, 'GET', '/api/split-groups')).json().items).toHaveLength(0);
  });

  it('protects participants in use and archived groups', async () => {
    expect((await call(ana, 'DELETE', g(`/participants/${biaP}`))).json().error.code).toBe(
      'participant_in_use',
    );
    const added = (await call(ana, 'POST', g('/participants'), { name: 'Eva' })).json();
    expect((await call(ana, 'DELETE', g(`/participants/${added.id}`))).statusCode).toBe(204);
    expect((await call(ana, 'PATCH', g(), { archived: true })).statusCode).toBe(204);
    expect(
      (await expense([[anaP, 1000]], [{ participantId: anaP }], 'equal', 1000)).json().error.code,
    ).toBe('group_archived');
    expect(
      (await call(ana, 'PATCH', g(), { archived: false, name: 'Viagem Floripa' })).statusCode,
    ).toBe(204);
    expect((await call(ana, 'GET', g())).json().name).toBe('Viagem Floripa');
  });
});

describe.skipIf(!testDatabaseUrl)('racha → personal space (integration)', () => {
  let drop: () => Promise<void>;
  let app: ReturnType<typeof buildApp>;
  let adminUrl: string;
  type User = { cookie: string; id: string; personal: string };
  let ana: User;
  let bia: User;
  let group = '';
  let anaP = '';
  let biaP = '';
  let anaAccount = '';
  let biaAccount = '';

  const call = (
    who: User,
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
  const g = (path = '') => `/api/split-groups/${group}${path}`;

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
    const me = (await call({ cookie, id: '', personal: '' }, 'GET', '/api/me')).json();
    return { cookie, id: me.user.id, personal: me.activeSpaceId };
  };
  const newAccount = async (who: User) =>
    (
      await call(who, 'POST', `/api/spaces/${who.personal}/accounts`, {
        name: 'Conta',
        type: 'checking',
        initialBalance: 100000,
        initialDate: '2026-01-01',
      })
    ).json().id as string;
  const txs = async (who: User) =>
    (
      (await call(who, 'GET', `/api/spaces/${who.personal}/transactions?limit=50`)).json()
        .items as {
        id: string;
        description: string;
        amount: number;
        status: string;
        date: string;
      }[]
    ).filter((t) => t.description.startsWith('Racha'));
  const balanceOf = async (who: User, account: string) =>
    (await call(who, 'GET', `/api/spaces/${who.personal}/accounts`))
      .json()
      .items.find((a: { id: string }) => a.id === account).balance as number;
  const addExpense = (amount: number, description = 'Jantar') =>
    call(ana, 'POST', g('/expenses'), {
      description,
      amount,
      date: '2026-10-10',
      mode: 'equal',
      payers: [{ participantId: anaP, amount }],
      shares: [{ participantId: anaP }, { participantId: biaP }],
    });

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
    anaAccount = await newAccount(ana);
    biaAccount = await newAccount(bia);
    group = (await call(ana, 'POST', '/api/split-groups', { name: 'Viagem' })).json().id;
    const code = (await call(ana, 'GET', g())).json().joinCode;
    await call(bia, 'POST', '/api/split-groups/join', { code });
    const people = (await call(ana, 'GET', g())).json().participants as {
      id: string;
      userId: string;
    }[];
    anaP = people.find((p) => p.userId === ana.id)?.id ?? '';
    biaP = people.find((p) => p.userId === bia.id)?.id ?? '';
    await addExpense(10000, 'Antes de ligar');
  });

  afterAll(async () => {
    await app?.close();
    await drop?.();
  });

  it('is off by default and rejects accounts that are not yours', async () => {
    expect((await call(ana, 'GET', g('/link'))).json()).toMatchObject({ linked: false });
    expect(await txs(ana)).toEqual([]);
    const stolen = await call(ana, 'PUT', g('/link'), {
      spaceId: bia.personal,
      accountId: biaAccount,
    });
    expect(stolen.statusCode).toBe(404);
    const wrongAccount = await call(ana, 'PUT', g('/link'), {
      spaceId: ana.personal,
      accountId: biaAccount,
    });
    expect(wrongAccount.statusCode).toBe(404);
  });

  it('turns my share into settled expenses, including past ones, once', async () => {
    const res = await call(ana, 'PUT', g('/link'), {
      spaceId: ana.personal,
      accountId: anaAccount,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ created: 1, updated: 0, removed: 0 });
    const mine = await txs(ana);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({
      amount: 5000,
      status: 'settled',
      description: 'Racha Viagem: Antes de ligar',
    });
    expect(await balanceOf(ana, anaAccount)).toBe(100000 - 5000);
    // Rodar de novo não duplica.
    expect((await call(ana, 'POST', g('/link/sync'))).json()).toEqual({
      created: 0,
      updated: 0,
      removed: 0,
    });
    expect(await txs(bia)).toEqual([]);
  });

  it('keeps linked users in sync when expenses change, are edited or deleted', async () => {
    await call(bia, 'PUT', g('/link'), { spaceId: bia.personal, accountId: biaAccount });
    expect(await txs(bia)).toHaveLength(1);

    const created = await addExpense(3000, 'Café');
    const id = created.json().id;
    expect((await txs(ana)).map((t) => t.amount).sort()).toEqual([1500, 5000]);
    expect((await txs(bia)).map((t) => t.amount).sort()).toEqual([1500, 5000]);

    await call(ana, 'PUT', g(`/expenses/${id}`), {
      description: 'Café',
      amount: 4000,
      date: '2026-10-12',
      mode: 'equal',
      payers: [{ participantId: anaP, amount: 4000 }],
      shares: [{ participantId: anaP }, { participantId: biaP }],
    });
    const cafe = (await txs(bia)).find((t) => t.description.endsWith('Café'));
    expect(cafe).toMatchObject({ amount: 2000, date: '2026-10-12' });

    await call(ana, 'DELETE', g(`/expenses/${id}`));
    expect((await txs(bia)).map((t) => t.amount)).toEqual([5000]);
    expect((await txs(ana)).map((t) => t.amount)).toEqual([5000]);
  });

  it('does not recreate what the user deleted, and unlinking keeps the history', async () => {
    const mine = await txs(bia);
    expect(
      (await call(bia, 'DELETE', `/api/spaces/${bia.personal}/transactions/${mine[0]?.id}`))
        .statusCode,
    ).toBe(204);
    expect((await call(bia, 'POST', g('/link/sync'))).json().created).toBe(0);
    expect(await txs(bia)).toEqual([]);

    expect((await call(ana, 'DELETE', g('/link'))).statusCode).toBe(204);
    await addExpense(2000, 'Depois de desligar');
    expect((await txs(ana)).map((t) => t.amount)).toEqual([5000]);
    expect((await call(ana, 'GET', g('/link'))).json().linked).toBe(false);
    expect((await call(ana, 'POST', g('/link/sync'))).json().error.code).toBe('not_linked');
  });

  it('stops posting into a shared space after the user leaves it', async () => {
    const space = (await call(ana, 'POST', '/api/spaces', { name: 'Casa' })).json().id;
    const invite = (await call(ana, 'POST', '/api/invites', { spaceId: space })).json();
    await call(bia, 'POST', '/api/invites/accept', { code: invite.code });
    const account = (
      await call(bia, 'POST', `/api/spaces/${space}/accounts`, {
        name: 'Conta da casa',
        type: 'checking',
        initialBalance: 0,
        initialDate: '2026-01-01',
      })
    ).json().id;
    expect(
      (await call(bia, 'PUT', g('/link'), { spaceId: space, accountId: account })).statusCode,
    ).toBe(200);
    const inSpace = async () =>
      (
        (await call(ana, 'GET', `/api/spaces/${space}/transactions?limit=50`)).json().items as {
          description: string;
        }[]
      ).filter((t) => t.description.startsWith('Racha')).length;
    // As despesas antigas já foram lançadas no espaço pessoal; uma nova vai para a casa.
    await addExpense(4000, 'Mercado da casa');
    const before = await inSpace();
    expect(before).toBe(1);

    await call(bia, 'DELETE', `/api/spaces/${space}/members/${bia.id}`);
    await addExpense(3000, 'Depois de sair');
    expect(await inSpace()).toBe(before);
  });
});
