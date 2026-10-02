import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app';
import { createAuth } from '../../auth/auth';
import { createAdminInvite } from '../../cli/create-invite';
import { createTempDb, testDatabaseUrl } from '../../test/temp-db';

const appUrl = 'http://localhost:5174';
const TODAY = '2026-10-15';

describe.skipIf(!testDatabaseUrl)('recurrences API (integration)', () => {
  let drop: () => Promise<void>;
  let app: ReturnType<typeof buildApp>;
  let cookie: string;
  let spaceId: string;
  let accountId: string;
  let cardId: string;

  type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';
  const api = (method: Method, path: string, payload?: unknown) =>
    app.inject({
      method,
      url: `/api/spaces/${spaceId}${path}`,
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
    spaceId = (await app.inject({ method: 'GET', url: '/api/me', headers: { cookie } })).json()
      .activeSpaceId;
    accountId = (
      await api('POST', '/accounts', {
        name: 'Conta',
        type: 'checking',
        initialBalance: 0,
        initialDate: '2026-01-01',
      })
    ).json().id;
    cardId = (
      await api('POST', '/cards', {
        name: 'Nubank',
        limitAmount: 100000,
        closingDay: 3,
        dueDay: 10,
      })
    ).json().id;
  });

  afterAll(async () => {
    await app?.close();
    await drop?.();
  });

  const occurrences = async (recurrenceId: string) =>
    (await api('GET', `/transactions?limit=200`))
      .json()
      .items.filter((t: { recurrenceId: string | null }) => t.recurrenceId === recurrenceId) as {
      id: string;
      date: string;
      amount: number;
      status: string;
      description: string;
      estimated: boolean;
      invoiceId: string | null;
    }[];

  const bill = {
    type: 'expense',
    description: 'Internet',
    amount: 9990,
    frequency: 'monthly',
    dayRule: { kind: 'fixed_day', day: 10 },
    startDate: '2026-10-01',
  };

  it('previews the split salary of RN 3', async () => {
    const res = await api('POST', '/recurrences/preview?months=2', {
      type: 'income',
      description: 'Salário',
      amount: 500000,
      frequency: 'monthly',
      startDate: '2026-09-01',
      accountId,
      parts: [
        {
          label: 'Adiantamento',
          percent: 40,
          dayRule: { kind: 'fixed_day', day: 15 },
          adjust: 'previous',
        },
        {
          label: 'Salário',
          percent: 60,
          dayRule: { kind: 'nth_business_day', n: 5 },
          monthOffset: 1,
        },
      ],
    });
    expect(res.statusCode).toBe(200);
    // Janela começa em outubro: salário de setembro (07/10) e adiantamento de outubro (15/10).
    expect(res.json().items.slice(0, 2)).toEqual([
      { date: '2026-10-07', amount: 300000, reference: '2026-09', label: 'Salário' },
      { date: '2026-10-15', amount: 200000, reference: '2026-10', label: 'Adiantamento' },
    ]);
  });

  it('creates a recurrence and keeps a 12-month window of planned entries', async () => {
    const res = await api('POST', '/recurrences', { ...bill, accountId });
    expect(res.statusCode).toBe(201);
    const rec = res.json();
    expect(rec).toMatchObject({ generatedUntil: '2027-10-31', amount: 9990 });
    expect(rec.next.map((n: { date: string }) => n.date)).toEqual([
      '2026-11-10',
      '2026-12-10',
      '2027-01-10',
    ]);
    const occ = await occurrences(rec.id);
    expect(occ).toHaveLength(13); // out/2026 a out/2027
    expect(occ.every((o) => o.status === 'planned' && o.description === 'Internet')).toBe(true);

    // Excluir uma ocorrência: a geração não recria.
    const nov = occ.find((o) => o.date === '2026-11-10');
    expect((await api('DELETE', `/transactions/${nov?.id}`)).statusCode).toBe(204);
    expect((await api('POST', '/recurrences/generate', {})).json().created).toBe(0);
    expect(await occurrences(rec.id)).toHaveLength(12);

    // Editar só uma ocorrência: vira "destacada" e não muda com a recorrência.
    const dec = occ.find((o) => o.date === '2026-12-10');
    await api('PATCH', `/transactions/${dec?.id}`, { amount: 15000 });

    // Descrição muda nos previstos não editados.
    await api('PATCH', `/recurrences/${rec.id}`, { description: 'Internet fibra' });
    const after = await occurrences(rec.id);
    expect(after.find((o) => o.date === '2027-01-10')?.description).toBe('Internet fibra');
    expect(after.find((o) => o.date === '2026-12-10')?.description).toBe('Internet');
  });

  it('changes the amount "from a month on" by splitting the recurrence (RN 3)', async () => {
    const rec = (
      await api('POST', '/recurrences', { ...bill, description: 'Academia', accountId })
    ).json();
    const oct = (await occurrences(rec.id)).find((o) => o.date === '2026-10-10');
    await api('POST', `/transactions/${oct?.id}/settle`, {});

    const res = await api('PATCH', `/recurrences/${rec.id}?from=2027-01`, { amount: 12990 });
    expect(res.statusCode).toBe(200);
    const next = res.json();
    expect(next.id).not.toBe(rec.id);
    expect(next).toMatchObject({ startDate: '2027-01-01', amount: 12990 });

    const old = (await api('GET', `/recurrences/${rec.id}`)).json();
    expect(old.endDate).toBe('2026-12-31');
    const oldOcc = await occurrences(rec.id);
    expect(oldOcc.map((o) => o.date)).toEqual(['2026-12-10', '2026-11-10', '2026-10-10']);
    expect(oldOcc.find((o) => o.date === '2026-10-10')?.status).toBe('settled');
    const newOcc = await occurrences(next.id);
    expect(newOcc.at(-1)).toMatchObject({ date: '2027-01-10', amount: 12990 });
    expect(newOcc).toHaveLength(10); // jan a out/2027
  });

  it('changes in place when the recurrence has not started yet', async () => {
    const rec = (
      await api('POST', '/recurrences', {
        ...bill,
        description: 'Seguro',
        startDate: '2026-12-01',
        accountId,
      })
    ).json();
    const res = await api('PATCH', `/recurrences/${rec.id}`, { amount: 5000 });
    expect(res.json().id).toBe(rec.id);
    const occ = await occurrences(rec.id);
    expect(occ).toHaveLength(11);
    expect(occ.every((o) => o.amount === 5000)).toBe(true);
  });

  it('puts card recurrences on invoices and marks variable amounts as estimated', async () => {
    const rec = (
      await api('POST', '/recurrences', {
        type: 'expense',
        description: 'Streaming',
        amount: 3990,
        frequency: 'monthly',
        dayRule: { kind: 'fixed_day', day: 5 },
        startDate: '2026-10-01',
        cardId,
      })
    ).json();
    const occ = await occurrences(rec.id);
    expect(occ.every((o) => o.invoiceId)).toBe(true);
    // 05/10 já passou: no cartão vira item efetivado (cai na fatura de novembro).
    expect(occ.find((o) => o.date === '2026-10-05')?.status).toBe('settled');
    const nov = (await api('GET', `/cards/${cardId}/invoices/2026-11`)).json();
    expect(nov.items).toBe(3990);

    const light = (
      await api('POST', '/recurrences', {
        ...bill,
        description: 'Luz',
        amount: 18000,
        variableAmount: true,
        accountId,
      })
    ).json();
    const first = (await occurrences(light.id)).at(-1);
    expect(first?.estimated).toBe(true);
    const settled = (
      await api('POST', `/transactions/${first?.id}/settle`, { amount: 21345 })
    ).json();
    expect(settled).toMatchObject({ estimated: false, amount: 21345 });
  });

  it('validates and ends recurrences', async () => {
    const weeklyParts = await api('POST', '/recurrences', {
      ...bill,
      frequency: 'weekly',
      dayRule: null,
      accountId,
      parts: [
        { percent: 50, dayRule: { kind: 'fixed_day', day: 1 } },
        { percent: 50, dayRule: { kind: 'fixed_day', day: 15 } },
      ],
    });
    expect(weeklyParts.statusCode).toBe(400);
    expect((await api('POST', '/recurrences', { ...bill })).statusCode).toBe(400); // sem conta
    expect(
      (
        await api('POST', '/recurrences', {
          ...bill,
          accountId,
          dayRule: undefined,
          parts: [
            { percent: 40, dayRule: { kind: 'fixed_day', day: 1 } },
            { percent: 50, dayRule: { kind: 'fixed_day', day: 15 } },
          ],
        })
      ).json().error.code,
    ).toBe('invalid_recurrence'); // soma 90%

    const rec = (
      await api('POST', '/recurrences', { ...bill, description: 'Revista', accountId })
    ).json();
    expect((await api('DELETE', `/recurrences/${rec.id}`)).statusCode).toBe(204);
    const left = await occurrences(rec.id);
    expect(left.map((o) => o.date)).toEqual(['2026-10-10']); // vencido continua para confirmar
    const list = (await api('GET', '/recurrences')).json().items;
    expect(list.map((r: { id: string }) => r.id)).not.toContain(rec.id);
  });

  it('accepts a start before the account balance date and skips earlier occurrences', async () => {
    const late = (
      await api('POST', '/accounts', {
        name: 'Nova',
        type: 'checking',
        initialBalance: 0,
        initialDate: '2026-10-12',
      })
    ).json();
    const rec = await api('POST', '/recurrences', {
      ...bill,
      description: 'Plano',
      startDate: '2026-01-01',
      accountId: late.id,
    });
    expect(rec.statusCode).toBe(201);
    const dates = (await occurrences(rec.json().id)).map((o) => o.date);
    expect(dates).not.toContain('2026-10-10');
    expect(dates.at(-1)).toBe('2026-11-10');
  });
});
