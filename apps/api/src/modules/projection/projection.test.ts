import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app';
import { createAuth } from '../../auth/auth';
import { createAdminInvite } from '../../cli/create-invite';
import { createTempDb, testDatabaseUrl } from '../../test/temp-db';

const appUrl = 'http://localhost:5174';
const TODAY = '2026-10-15';

describe.skipIf(!testDatabaseUrl)('projection API (integration)', () => {
  let drop: () => Promise<void>;
  let app: ReturnType<typeof buildApp>;
  let cookie: string;
  let spaceId: string;

  type Method = 'GET' | 'POST';
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
  });

  afterAll(async () => {
    await app?.close();
    await drop?.();
  });

  it('projects balance month by month from planned entries and invoices (RN 7)', async () => {
    const account = (
      await api('POST', '/accounts', {
        name: 'Conta',
        type: 'checking',
        initialBalance: 100000,
        initialDate: '2026-01-01',
      })
    ).json();
    // Reserva fora dos totais: não entra no saldo inicial.
    await api('POST', '/accounts', {
      name: 'Reserva',
      type: 'savings',
      initialBalance: 999999,
      initialDate: '2026-01-01',
      includeInTotals: false,
    });
    const card = (
      await api('POST', '/cards', {
        name: 'Nubank',
        limitAmount: 100000,
        closingDay: 3,
        dueDay: 10,
      })
    ).json();

    await api('POST', '/transactions', {
      type: 'income',
      status: 'planned',
      amount: 500000,
      date: '2026-11-05',
      description: 'Freela',
      accountId: account.id,
    });
    await api('POST', '/recurrences', {
      type: 'expense',
      description: 'Aluguel',
      amount: 150000,
      frequency: 'monthly',
      dayRule: { kind: 'fixed_day', day: 10 },
      startDate: '2026-10-01',
      accountId: account.id,
    });
    await api('POST', '/installment-plans', {
      description: 'Curso',
      accountId: account.id,
      totalAmount: 90000,
      installments: 3,
      firstDate: '2026-10-01',
      firstDueDate: '2026-11-07',
    });
    // Fatura de outubro já vencida (5000) e a de novembro (20000).
    for (const [amount, date] of [
      [5000, '2026-10-02'],
      [20000, '2026-10-14'],
    ] as const) {
      await api('POST', '/transactions', {
        type: 'expense',
        amount,
        date,
        description: 'Compra',
        cardId: card.id,
      });
    }

    const res = await api('GET', '/projection?months=3');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.startingBalance).toBe(100000);
    const [oct, nov, dec] = body.months;
    // Aluguel de 10/10 ainda previsto e fatura vencida entram no 1º mês.
    expect(oct).toMatchObject({
      month: '2026-10',
      openingBalance: 100000,
      fixedExpenses: 150000,
      invoices: 5000,
      income: 0,
      closingBalance: -55000,
      negative: true,
    });
    expect(nov).toMatchObject({
      income: 500000,
      fixedExpenses: 150000,
      invoices: 20000,
      debts: 30000,
      committed: 200000,
      free: 300000,
      closingBalance: 245000,
      negative: false,
    });
    expect(dec).toMatchObject({ fixedExpenses: 150000, debts: 30000, closingBalance: 65000 });
    expect((await api('GET', '/projection?months=40')).statusCode).toBe(400);
  });
});
