import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app';
import { createAuth } from '../../auth/auth';
import { createAdminInvite } from '../../cli/create-invite';
import { createTempDb, testDatabaseUrl } from '../../test/temp-db';

const appUrl = 'http://localhost:5174';
const TODAY = '2026-10-15';

describe.skipIf(!testDatabaseUrl)('reports API (integration)', () => {
  let drop: () => Promise<void>;
  let app: ReturnType<typeof buildApp>;
  let cookie: string;
  let spaceId: string;
  let accountId: string;
  let cardId: string;

  type Method = 'GET' | 'POST';
  const api = (method: Method, path: string, payload?: unknown) =>
    app.inject({
      method,
      url: `/api/spaces/${spaceId}${path}`,
      headers: { cookie, origin: appUrl },
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });

  const entry = (type: 'income' | 'expense', amount: number, date: string, extra = {}) =>
    api('POST', '/transactions', {
      type,
      status: 'settled',
      amount,
      date,
      description: 'Lançamento',
      accountId,
      ...extra,
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
        initialBalance: 1000000,
        initialDate: '2026-01-01',
      })
    ).json().id;
    cardId = (
      await api('POST', '/cards', {
        name: 'Nubank',
        limitAmount: 500000,
        closingDay: 5,
        dueDay: 12,
      })
    ).json().id;
  });

  afterAll(async () => {
    await app?.close();
    await drop?.();
  });

  const expenseCategories = async () =>
    (await api('GET', '/categories?kind=expense')).json().items as { id: string; name: string }[];

  it('breaks expenses down by category, with card by invoice month and uncategorized', async () => {
    const [a, b] = await expenseCategories();
    if (!a || !b) throw new Error('categorias padrão ausentes');
    await entry('expense', 40000, '2026-10-03', { categoryId: a.id });
    await entry('expense', 10000, '2026-10-04', { categoryId: b.id });
    await entry('expense', 5000, '2026-10-05'); // sem categoria
    // Cartão: 10/10 vai para a fatura de novembro; 02/10 para a de outubro.
    await api('POST', '/transactions', {
      type: 'expense',
      status: 'settled',
      amount: 20000,
      date: '2026-10-10',
      description: 'Cartão',
      categoryId: a.id,
      cardId,
    });
    await api('POST', '/transactions', {
      type: 'expense',
      status: 'settled',
      amount: 3000,
      date: '2026-10-02',
      description: 'Cartão',
      categoryId: a.id,
      cardId,
    });
    // Previsto não entra.
    await entry('expense', 99999, '2026-10-20', { categoryId: a.id, status: 'planned' });

    const oct = (await api('GET', '/reports/by-category?from=2026-10&to=2026-10')).json();
    expect(oct.total).toBe(58000);
    expect(oct.items.map((i: { name: string; amount: number }) => [i.name, i.amount])).toEqual([
      [a.name, 43000],
      [b.name, 10000],
      ['Sem categoria', 5000],
    ]);
    expect(oct.items[0].share).toBeCloseTo(43000 / 58000);

    const both = (await api('GET', '/reports/by-category?from=2026-10&to=2026-11')).json();
    expect(both.total).toBe(78000);
    expect((await api('GET', '/reports/by-category?from=2026-11&to=2026-10')).statusCode).toBe(400);
  });

  it('summarizes months with income, expense and savings rate', async () => {
    await entry('income', 300000, '2026-09-05');
    await entry('income', 200000, '2026-10-05');
    const res = (await api('GET', '/reports/monthly?months=3')).json();
    expect(res.items.map((i: { month: string }) => i.month)).toEqual([
      '2026-08',
      '2026-09',
      '2026-10',
    ]);
    expect(res.items[1]).toMatchObject({ income: 300000, expense: 0, savingsRate: 1 });
    expect(res.items[2]).toMatchObject({ income: 200000, expense: 58000, balance: 142000 });
    expect(res.items[0]).toMatchObject({ income: 0, savingsRate: null });
    expect(res.totals).toMatchObject({ income: 500000, expense: 58000, balance: 442000 });
  });

  it('computes net worth from accounts, open invoices and debts', async () => {
    await api('POST', '/debts', {
      name: 'Empréstimo',
      kind: 'bank_loan',
      paymentAccountId: accountId,
      phases: [
        {
          system: 'fixed',
          principal: 100000,
          installments: 10,
          installmentAmount: 10000,
          firstDueDate: '2026-11-10',
        },
      ],
    });
    const nw = (await api('GET', '/reports/net-worth')).json();
    // Conta: 1.000.000 + receitas 500.000 − despesas da conta efetivadas (40.000 + 10.000 + 5.000).
    const accountBalance = 1000000 + 500000 - 55000;
    expect(nw.assetLines).toEqual([{ label: 'Contas', amount: accountBalance }]);
    expect(nw.liabilityLines.map((l: { label: string }) => l.label)).toEqual([
      'Faturas de cartão em aberto',
      'Dívidas e financiamentos',
    ]);
    const cards = nw.liabilityLines[0].amount;
    const debts = nw.liabilityLines[1].amount;
    expect(cards).toBe(23000);
    expect(debts).toBe(100000);
    expect(nw).toMatchObject({
      assets: accountBalance,
      liabilities: cards + debts,
      net: accountBalance - cards - debts,
    });
  });
});
