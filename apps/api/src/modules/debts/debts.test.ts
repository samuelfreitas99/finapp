import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app';
import { createAuth } from '../../auth/auth';
import { createAdminInvite } from '../../cli/create-invite';
import { settleDueCardInstallments } from '../../jobs/debts';
import { createTempDb, testDatabaseUrl } from '../../test/temp-db';

const appUrl = 'http://localhost:5174';
const TODAY = '2026-10-15';

describe.skipIf(!testDatabaseUrl)('debts API (integration)', () => {
  let drop: () => Promise<void>;
  let app: ReturnType<typeof buildApp>;
  let cookie: string;
  let spaceId: string;
  let accountId: string;
  let cardId: string;
  let db: Awaited<ReturnType<typeof createTempDb>>['db'];

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
    db = temp.db;
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
      })
    ).json().id;
  });

  afterAll(async () => {
    await app?.close();
    await drop?.();
  });

  const loan = {
    name: 'Empréstimo banco',
    kind: 'bank_loan',
    phases: [
      {
        system: 'price',
        principal: 100000,
        rateMonthly: 0.01,
        installments: 12,
        firstDueDate: '2026-11-10',
      },
    ],
  };

  const planned = async (debtId: string) => {
    const detail = (await api('GET', `/debts/${debtId}`)).json();
    const list = (
      await api('GET', `/transactions?limit=200&q=${encodeURIComponent(detail.name)}`)
    ).json().items as {
      description: string;
      status: string;
      amount: number;
      type: string;
      accountId: string | null;
      cardId: string | null;
      invoiceId: string | null;
    }[];
    return list.filter((t) => t.description.startsWith(detail.name));
  };

  it('previews a Price loan without saving (RN 6.1)', async () => {
    const res = await api('POST', '/debts/preview', loan);
    expect(res.statusCode).toBe(200);
    const { rows, summary } = res.json();
    expect(rows).toHaveLength(12);
    expect(rows[0]).toMatchObject({ dueDate: '2026-11-10', amount: 8885, interestPart: 1000 });
    expect(rows.at(-1).balanceAfter).toBe(0);
    expect(summary).toMatchObject({ totalCount: 12, paidCount: 0, outstandingPrincipal: 100000 });
    expect((await api('GET', '/debts')).json().items).toHaveLength(0);
  });

  it('creates a loan with planned entries on the paying account (RN 6.3, 6.4)', async () => {
    const res = await api('POST', '/debts', { ...loan, paymentAccountId: accountId });
    expect(res.statusCode).toBe(201);
    const debt = res.json();
    expect(debt).toMatchObject({
      principal: 100000,
      status: 'active',
      summary: { totalCount: 12, remainingCount: 12, expectedPayoffDate: '2027-10-10' },
      next: { number: 1, dueDate: '2026-11-10', amount: 8885, status: 'pending' },
    });
    expect(debt.phases).toHaveLength(1);
    const entries = await planned(debt.id);
    expect(entries).toHaveLength(12);
    expect(entries.every((e) => e.status === 'planned' && e.accountId === accountId)).toBe(true);
    expect(entries.map((e) => e.amount).reduce((a, b) => a + b, 0)).toBe(
      debt.summary.remainingAmount,
    );

    // Projeção: parcelas entram como dívidas.
    const nov = (await api('GET', '/projection?months=2')).json().months[1];
    expect(nov.debts).toBe(8885);
  });

  it('registers a debt in progress with installments already paid', async () => {
    const debt = (
      await api('POST', '/debts', {
        ...loan,
        name: 'Financiamento carro',
        kind: 'financing',
        paymentAccountId: accountId,
        paidInstallments: 3,
        phases: [{ ...loan.phases[0], system: 'sac', firstDueDate: '2026-08-10' }],
      })
    ).json();
    expect(debt.summary).toMatchObject({ paidCount: 3, remainingCount: 9 });
    expect(debt.next).toMatchObject({ number: 4, dueDate: '2026-11-10' });
    expect(await planned(debt.id)).toHaveLength(9);
  });

  it('builds a property under construction with four phases (RN 6.7)', async () => {
    const res = await api('POST', '/debts', {
      name: 'Apartamento',
      kind: 'property',
      completionDate: '2027-06-30',
      assetValue: 50000000,
      paymentAccountId: accountId,
      phases: [
        {
          name: 'Entrada',
          system: 'fixed',
          installments: 24,
          installmentAmount: 50000,
          firstDueDate: '2026-11-10',
          index: 'incc',
        },
        {
          name: 'Intermediárias',
          system: 'balloon',
          firstDueDate: '2026-12-20',
          payments: [
            { dueDate: '2026-12-20', amount: 1000000 },
            { dueDate: '2027-12-20', amount: 1000000 },
          ],
        },
        {
          name: 'Juros de obra',
          system: 'variable',
          firstDueDate: '2026-11-15',
          endsAtCompletion: true,
          values: [{ month: '2026-11', amount: 30000 }],
        },
        {
          name: 'Financiamento',
          system: 'price',
          principal: 30000000,
          rateAnnual: 0.1,
          installments: 360,
          firstDueDate: '2027-01-10',
          startsAfterCompletion: true,
          index: 'ipca',
        },
      ],
    });
    expect(res.statusCode).toBe(201);
    const debt = res.json();
    expect(
      debt.phases.map((p: { name: string; installments: number }) => [p.name, p.installments]),
    ).toEqual([
      ['Entrada', 24],
      ['Intermediárias', 2],
      ['Juros de obra', 8], // nov/2026 a jun/2027
      ['Financiamento', 360],
    ]);
    const financing = debt.phases[3];
    expect(financing.startDate).toBe('2027-07-10'); // mês seguinte à entrega
    expect(financing.rateMonthly).toBeCloseTo(0.00797414, 6);
    const works = debt.installments.filter(
      (i: { phaseId: string }) => i.phaseId === debt.phases[2].id,
    );
    expect(works.filter((i: { estimated: boolean }) => i.estimated)).toHaveLength(7);
    expect(debt.equity).toBe(50000000 - debt.summary.outstandingPrincipal);
    expect(debt.summary.totalCount).toBe(24 + 2 + 8 + 360);
  });

  it('puts card-paid installments on invoices and lent money as receivables (RN 6.6)', async () => {
    const cardLoan = (
      await api('POST', '/debts', {
        name: 'Empréstimo no cartão',
        kind: 'card_loan',
        paymentCardId: cardId,
        phases: [{ system: 'fixed', installments: 3, total: 30000, firstDueDate: '2026-11-05' }],
      })
    ).json();
    expect(cardLoan.error).toBeUndefined();
    const items = await planned(cardLoan.id);
    expect(items).toHaveLength(3);
    expect(items.every((i) => i.cardId === cardId && i.invoiceId && !i.accountId)).toBe(true);

    const lent = (
      await api('POST', '/debts', {
        name: 'Emprestei ao João',
        kind: 'personal_loan',
        direction: 'owed_to_me',
        paymentAccountId: accountId,
        phases: [
          {
            system: 'fixed',
            installments: 2,
            installmentAmount: 25000,
            firstDueDate: '2026-11-20',
          },
        ],
      })
    ).json();
    const receivables = await planned(lent.id);
    expect(receivables.map((r) => r.type)).toEqual(['income', 'income']);
  });

  it('counts card installments already on an invoice as paid, without duplicating', async () => {
    // Começou em setembro: as parcelas de 05/09 e 05/10 já passaram (hoje é 15/10).
    const debt = (
      await api('POST', '/debts', {
        name: 'Saque no cartão',
        kind: 'card_loan',
        paymentCardId: cardId,
        phases: [{ system: 'fixed', installments: 4, total: 40000, firstDueDate: '2026-09-05' }],
      })
    ).json();
    expect(debt.installments.map((i: { status: string }) => i.status)).toEqual([
      'paid',
      'paid',
      'pending',
      'pending',
    ]);
    expect(debt.summary).toMatchObject({ paidCount: 2, lateCount: 0 });
    const before = await planned(debt.id);
    expect(before.filter((t) => t.status === 'settled')).toHaveLength(2);

    // Uma ação na dívida refaz os previstos: os efetivados não podem voltar em dobro.
    await api('POST', `/debts/${debt.id}/installments/3/pay`, { amount: 5000 });
    const after = await planned(debt.id);
    expect(after.filter((t) => t.status === 'settled')).toHaveLength(3);
    expect(after).toHaveLength(5); // 2 pagas + parcial da 3ª + resto da 3ª + 4ª

    // Quando a 4ª vence (05/01/2027), o job do dia efetiva e marca como paga.
    expect(await settleDueCardInstallments(db, '2027-01-05')).toBeGreaterThanOrEqual(2);
    const done = (await api('GET', `/debts/${debt.id}`)).json();
    expect(done.status).toBe('paid_off');
  });

  it('marks the installment paid when its planned entry is confirmed in Lançamentos', async () => {
    const debt = (
      await api('POST', '/debts', {
        name: 'Empréstimo confirmado',
        kind: 'bank_loan',
        paymentAccountId: accountId,
        phases: [
          {
            system: 'fixed',
            installments: 2,
            installmentAmount: 30000,
            firstDueDate: '2026-10-10',
          },
        ],
      })
    ).json();
    const items = (
      await api('GET', `/transactions?limit=50&status=planned&q=${encodeURIComponent(debt.name)}`)
    ).json().items as { id: string; date: string }[];
    const first = items.find((t) => t.date === '2026-10-10');
    expect((await api('POST', `/transactions/${first?.id}/settle`, {})).statusCode).toBe(200);
    const detail = (await api('GET', `/debts/${debt.id}`)).json();
    expect(detail.installments[0]).toMatchObject({ status: 'paid', paidAmount: 30000 });
    // Confirmar com valor menor deixa parcial e refaz o previsto do restante.
    const second = items.find((t) => t.date === '2026-11-10');
    await api('POST', `/transactions/${second?.id}/settle`, { amount: 10000, date: TODAY });
    const partial = (await api('GET', `/debts/${debt.id}`)).json();
    expect(partial.installments[1]).toMatchObject({ status: 'partial', paidAmount: 10000 });
    const rest = (
      await api('GET', `/transactions?limit=50&status=planned&q=${encodeURIComponent(debt.name)}`)
    ).json().items as { amount: number }[];
    expect(rest.map((r) => r.amount)).toEqual([20000]);
  });

  it('validates and cancels debts', async () => {
    const bad = (phases: unknown[], extra: Record<string, unknown> = {}) =>
      api('POST', '/debts/preview', { name: 'X', kind: 'other', phases, ...extra });
    expect(
      (
        await bad([
          { system: 'price', principal: 1000, installments: 2, firstDueDate: '2026-11-10' },
        ])
      ).statusCode,
    ).toBe(400); // sem taxa
    expect(
      (
        await bad([
          {
            system: 'variable',
            firstDueDate: '2026-11-10',
            endsAtCompletion: true,
            values: [{ month: '2026-11', amount: 1 }],
          },
        ])
      ).statusCode,
    ).toBe(400); // sem data de entrega
    expect(
      (
        await api('POST', '/debts', {
          ...loan,
          paymentAccountId: accountId,
          paymentCardId: cardId,
        })
      ).statusCode,
    ).toBe(400);

    const debt = (
      await api('POST', '/debts', { ...loan, name: 'Cancelar', paymentAccountId: accountId })
    ).json();
    await api('PATCH', `/debts/${debt.id}`, { notes: 'renegociado', assetValue: null });
    expect((await api('DELETE', `/debts/${debt.id}`)).statusCode).toBe(204);
    expect((await api('GET', `/debts/${debt.id}`)).json()).toMatchObject({
      status: 'cancelled',
      next: null,
      notes: 'renegociado',
    });
    expect(await planned(debt.id)).toHaveLength(0);
  });

  it('moves the borrowed or lent money without counting it as income or spending (RN 6.6)', async () => {
    const before = (await api('GET', `/accounts/${accountId}`)).json().balance;
    const dashBefore = (await api('GET', '/dashboard')).json();
    const cardLoan = await api('POST', '/debts', {
      name: 'Saque no cartão',
      kind: 'card_loan',
      principal: 30000,
      paymentCardId: cardId,
      moneyAccountId: accountId,
      phases: [{ system: 'fixed', installments: 3, total: 33000, firstDueDate: '2026-11-05' }],
    });
    expect(cardLoan.statusCode).toBe(201);
    const lent = await api('POST', '/debts', {
      name: 'Emprestei à Maria',
      kind: 'personal_loan',
      direction: 'owed_to_me',
      principal: 10000,
      moneyAccountId: accountId,
      paymentAccountId: accountId,
      phases: [
        { system: 'fixed', installments: 1, installmentAmount: 10000, firstDueDate: '2026-12-01' },
      ],
    });
    expect(lent.statusCode).toBe(201);
    expect((await api('GET', `/accounts/${accountId}`)).json().balance).toBe(
      before + 30000 - 10000,
    );
    const dash = (await api('GET', '/dashboard')).json();
    expect(dash.income.settled).toBe(dashBefore.income.settled);
    expect(dash.expense.settled).toBe(dashBefore.expense.settled);

    const bad = (body: Record<string, unknown>) =>
      api('POST', '/debts/preview', {
        name: 'X',
        phases: [
          { system: 'fixed', installments: 1, installmentAmount: 100, firstDueDate: '2026-11-05' },
        ],
        ...body,
      });
    expect((await bad({ kind: 'third_party_card', paymentCardId: cardId })).statusCode).toBe(400);
    expect((await bad({ kind: 'card_loan' })).statusCode).toBe(400);
    expect((await bad({ kind: 'bank_loan', moneyAccountId: accountId })).statusCode).toBe(400);
  });
});
