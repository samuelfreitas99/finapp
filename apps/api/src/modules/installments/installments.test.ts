import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app';
import { createAuth } from '../../auth/auth';
import { createAdminInvite } from '../../cli/create-invite';
import { createTempDb, testDatabaseUrl } from '../../test/temp-db';

const appUrl = 'http://localhost:5174';
const TODAY = '2026-10-15';

describe.skipIf(!testDatabaseUrl)('installment plans API (integration)', () => {
  let drop: () => Promise<void>;
  let app: ReturnType<typeof buildApp>;
  let cookie: string;
  let spaceId: string;
  let cardId: string;
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
    cardId = (
      await api('POST', '/cards', {
        name: 'Nubank',
        limitAmount: 1000000,
        closingDay: 3,
        dueDay: 10,
        paymentAccountId: accountId,
      })
    ).json().id;
  });

  afterAll(async () => {
    await app?.close();
    await drop?.();
  });

  const invoice = async (month: string) =>
    (await api('GET', `/cards/${cardId}/invoices/${month}`)).json();

  it('previews and creates a card plan, one installment per invoice (RN 5.1, 5.2)', async () => {
    const body = {
      description: 'Geladeira',
      cardId,
      totalAmount: 10000,
      installments: 3,
      firstDate: '2026-10-14',
    };
    const preview = (await api('POST', '/installment-plans/preview', body)).json();
    expect(preview.items).toEqual([
      { number: 1, amount: 3334, date: '2026-10-14', invoiceMonth: '2026-11' },
      { number: 2, amount: 3333, date: '2026-11-14', invoiceMonth: '2026-12' },
      { number: 3, amount: 3333, date: '2026-12-14', invoiceMonth: '2027-01' },
    ]);

    const created = await api('POST', '/installment-plans', body);
    expect(created.statusCode).toBe(201);
    const plan = created.json();
    expect(plan).toMatchObject({
      status: 'active',
      totalAmount: 10000,
      summary: { paidCount: 0, remainingCount: 3, remainingAmount: 10000 },
      next: { number: 1, amount: 3334, invoiceMonth: '2026-11' },
    });
    expect(plan.entries.map((e: { description: string }) => e.description)).toEqual([
      'Geladeira (1/3)',
      'Geladeira (2/3)',
      'Geladeira (3/3)',
    ]);
    expect((await invoice('2026-12')).items).toBe(3333);

    const first = plan.entries[0];
    expect((await api('PATCH', `/transactions/${first.id}`, { amount: 1 })).json().error.code).toBe(
      'installment_locked',
    );
    expect((await api('DELETE', `/transactions/${first.id}`)).json().error.code).toBe(
      'installment_locked',
    );
    expect(
      (await api('PATCH', `/transactions/${first.id}`, { description: 'Geladeira nova (1/3)' }))
        .statusCode,
    ).toBe(200);
  });

  it('registers a plan already in progress (RN 5.3)', async () => {
    const plan = (
      await api('POST', '/installment-plans', {
        description: 'Notebook',
        cardId,
        installmentAmount: 25000,
        installments: 10,
        startInstallment: 4,
        firstDate: '2026-07-10',
      })
    ).json();
    expect(plan.totalAmount).toBe(250000);
    expect(plan.entries).toHaveLength(7);
    expect(plan.next).toMatchObject({ number: 4, invoiceMonth: '2026-11' });
    expect(plan.entries[0].date).toBe('2026-10-10');
  });

  it('anticipates the last installments with a present value discount (RN 5.5)', async () => {
    const plan = (
      await api('POST', '/installment-plans', {
        description: 'TV',
        cardId,
        totalAmount: 60000,
        installments: 6,
        firstDate: '2026-10-14',
      })
    ).json();
    const before = (await invoice('2026-11')).items;
    const res = await api('POST', `/installment-plans/${plan.id}/anticipate`, {
      count: 2,
      discount: { monthlyRate: 0.02 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      discount: 1704,
      moved: [
        { number: 5, fromMonth: '2027-03', months: 4 },
        { number: 6, fromMonth: '2027-04', months: 5 },
      ],
    });
    const moved = res.json().entries.filter((e: { anticipated: boolean }) => e.anticipated);
    expect(moved).toHaveLength(2);
    expect((await invoice('2026-11')).items).toBe(before + 20000 - 1704);
    expect(
      (await api('POST', `/installment-plans/${plan.id}/anticipate`, { count: 5 })).json().error
        .code,
    ).toBe('invalid_anticipation');
  });

  it('cancels a card plan, refunding billed installments when asked (RN 5.4)', async () => {
    const plan = (
      await api('POST', '/installment-plans', {
        description: 'Sofá',
        cardId,
        totalAmount: 3000,
        installments: 3,
        firstDate: '2026-09-01',
      })
    ).json();
    expect(plan.entries.map((e: { status: string }) => e.status)).toEqual([
      'settled',
      'settled',
      'planned',
    ]);
    const nov = (await invoice('2026-11')).items;
    const res = await api('POST', `/installment-plans/${plan.id}/cancel`, { refundBilled: true });
    expect(res.json()).toMatchObject({ status: 'cancelled', next: null });
    expect(res.json().entries).toHaveLength(2);
    // Parcela de novembro cancelada (−1000) e estorno das duas já faturadas (−2000).
    expect((await invoice('2026-11')).items).toBe(nov - 1000 - 2000);
    expect((await api('POST', `/installment-plans/${plan.id}/cancel`, {})).statusCode).toBe(400);
  });

  it('handles plans outside the card (carnê/boleto) with business-day adjustment', async () => {
    const plan = (
      await api('POST', '/installment-plans', {
        description: 'Curso',
        accountId,
        totalAmount: 30000,
        installments: 2,
        firstDate: '2026-10-01',
        firstDueDate: '2026-11-07',
        adjust: 'next',
      })
    ).json();
    // 07/11/2026 é sábado: vence na segunda, 09/11.
    expect(
      plan.entries.map((e: { date: string; status: string; accountId: string }) => [
        e.date,
        e.status,
        e.accountId,
      ]),
    ).toEqual([
      ['2026-11-09', 'planned', accountId],
      ['2026-12-07', 'planned', accountId],
    ]);

    await api('POST', `/transactions/${plan.entries[0].id}/settle`, { date: '2026-10-15' });
    const after = (await api('GET', `/installment-plans/${plan.id}`)).json();
    expect(after.summary).toMatchObject({ paidCount: 1, remainingCount: 1 });
    expect(
      (await api('POST', `/installment-plans/${plan.id}/anticipate`, { count: 1 })).json().error
        .code,
    ).toBe('not_a_card_plan');

    const cancelled = (await api('POST', `/installment-plans/${plan.id}/cancel`, {})).json();
    expect(cancelled.entries).toHaveLength(1);
    expect(cancelled.status).toBe('cancelled');

    const active = (await api('GET', '/installment-plans?status=active')).json().items;
    expect(active.map((p: { description: string }) => p.description).sort()).toEqual([
      'Geladeira',
      'Notebook',
      'TV',
    ]);
  });

  it('validates the plan body', async () => {
    const base = { description: 'X', installments: 2, firstDate: '2026-10-01' };
    const bad = (body: Record<string, unknown>) =>
      api('POST', '/installment-plans/preview', { ...base, ...body });
    expect((await bad({ cardId, totalAmount: 1, installmentAmount: 1 })).statusCode).toBe(400);
    expect((await bad({ cardId, accountId, totalAmount: 1 })).statusCode).toBe(400);
    expect((await bad({ accountId, totalAmount: 1 })).statusCode).toBe(400); // sem vencimento
    expect((await bad({ cardId, totalAmount: 100, startInstallment: 3 })).statusCode).toBe(400);
  });
});
