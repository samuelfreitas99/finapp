import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app';
import { createAuth } from '../../auth/auth';
import { createAdminInvite } from '../../cli/create-invite';
import { createTempDb, testDatabaseUrl } from '../../test/temp-db';

const appUrl = 'http://localhost:5174';
const TODAY = '2026-10-15';

describe.skipIf(!testDatabaseUrl)('debt payments, amortization and payoff (integration)', () => {
  let drop: () => Promise<void>;
  let app: ReturnType<typeof buildApp>;
  let cookie: string;
  let spaceId: string;
  let accountId: string;

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
  });

  afterAll(async () => {
    await app?.close();
    await drop?.();
  });

  const create = async (over: Record<string, unknown> = {}) =>
    (
      await api('POST', '/debts', {
        name: `Empréstimo ${Math.random().toString(36).slice(2, 6)}`,
        kind: 'bank_loan',
        paymentAccountId: accountId,
        phases: [
          {
            system: 'price',
            principal: 100000,
            rateMonthly: 0.01,
            installments: 12,
            firstDueDate: '2026-10-10',
          },
        ],
        ...over,
      })
    ).json();

  const balance = async () => (await api('GET', `/accounts/${accountId}`)).json().balance as number;
  const plannedOf = async (name: string) =>
    (
      await api('GET', `/transactions?limit=200&status=planned&q=${encodeURIComponent(name)}`)
    ).json().items as { amount: number; date: string }[];

  it('pays a late installment by settling its planned entry (RN 6.3)', async () => {
    const debt = await create();
    expect(debt.installments[0].status).toBe('late');
    const before = await balance();
    const res = await api('POST', `/debts/${debt.id}/installments/1/pay`, {});
    expect(res.statusCode).toBe(200);
    const paid = res.json();
    expect(paid.installments[0]).toMatchObject({
      status: 'paid',
      paidAmount: 8885,
      paidDate: TODAY,
    });
    expect(paid.summary).toMatchObject({ paidCount: 1, lateCount: 0 });
    expect(await balance()).toBe(before - 8885);
    expect(await plannedOf(debt.name)).toHaveLength(11);
    expect((await api('POST', `/debts/${debt.id}/installments/1/pay`, {})).json().error.code).toBe(
      'already_paid',
    );
    expect(
      (await api('POST', `/debts/${debt.id}/installments/2/pay`, { date: '2026-10-20' })).json()
        .error.code,
    ).toBe('settled_in_future');
  });

  it('accepts partial payments and keeps the rest planned', async () => {
    const debt = await create();
    const res = (
      await api('POST', `/debts/${debt.id}/installments/2/pay`, { amount: 5000 })
    ).json();
    expect(res.installments[1]).toMatchObject({ status: 'partial', paidAmount: 5000 });
    const planned = await plannedOf(debt.name);
    expect(planned.find((p) => p.date === '2026-11-10')?.amount).toBe(3885);
    const done = (await api('POST', `/debts/${debt.id}/installments/2/pay`, {})).json();
    expect(done.installments[1]).toMatchObject({ status: 'paid', paidAmount: 8885 });
  });

  it('pays a future installment early with a present value discount (RN 6.5)', async () => {
    const debt = await create();
    const last = debt.installments.at(-1);
    const res = (
      await api('POST', `/debts/${debt.id}/installments/12/pay`, { discountMonthlyRate: 0.01 })
    ).json();
    const paid = res.installments.at(-1);
    // 11 meses de antecipação a 1% a.m.: desconto pelo valor presente, arredondado para baixo.
    expect(paid.status).toBe('paid');
    expect(paid.discount).toBe(last.amount - Math.ceil(last.amount / 1.01 ** 11));
    expect(paid.paidAmount + paid.discount).toBe(last.amount);
  });

  it('amortizes extra reducing the term and pays off the rest (RN 6.5)', async () => {
    const debt = await create({ name: 'Amortizar' });
    await api('POST', `/debts/${debt.id}/installments/1/pay`, {});
    const before = await balance();
    const res = await api('POST', `/debts/${debt.id}/amortize`, {
      amount: 30000,
      mode: 'reduce_term',
    });
    expect(res.statusCode).toBe(200);
    const after = res.json();
    const pending = after.installments.filter((i: { status: string }) => i.status !== 'paid');
    expect(pending.length).toBeLessThan(11);
    expect(pending[0].amount).toBe(8885);
    expect(after.installments.map((i: { number: number }) => i.number)).toEqual(
      after.installments.map((_: unknown, k: number) => k + 1),
    );
    expect(await balance()).toBe(before - 30000);
    expect(await plannedOf('Amortizar')).toHaveLength(pending.length);

    const outstanding = after.summary.outstandingPrincipal;
    const off = (await api('POST', `/debts/${debt.id}/payoff`, {})).json();
    expect(off).toMatchObject({ status: 'paid_off', next: null });
    expect(off.summary.remainingCount).toBe(0);
    expect(await balance()).toBe(before - 30000 - outstanding);
    expect(await plannedOf('Amortizar')).toHaveLength(0);
    expect((await api('POST', `/debts/${debt.id}/payoff`, {})).json().error.code).toBe(
      'debt_not_active',
    );
  });

  it('amortizes reducing the installment and rejects non-amortizable phases', async () => {
    const debt = await create({ name: 'Reduzir parcela' });
    const res = (
      await api('POST', `/debts/${debt.id}/amortize`, { amount: 20000, mode: 'reduce_installment' })
    ).json();
    const pending = res.installments.filter((i: { status: string }) => i.status !== 'paid');
    expect(pending).toHaveLength(12);
    expect(pending[0].amount).toBeLessThan(8885);

    const fixed = await create({
      name: 'Fixa',
      phases: [
        { system: 'fixed', installments: 3, installmentAmount: 1000, firstDueDate: '2026-11-10' },
      ],
    });
    expect(
      (
        await api('POST', `/debts/${fixed.id}/amortize`, { amount: 100, mode: 'reduce_term' })
      ).json().error.code,
    ).toBe('invalid_phase');
    // Dívida paga por fora (sem conta): pagar só marca a parcela.
    const tracked = await create({ name: 'Só acompanhar', paymentAccountId: undefined });
    const r = (await api('POST', `/debts/${tracked.id}/installments/1/pay`, {})).json();
    expect(r.installments[0].status).toBe('paid');
  });
});
