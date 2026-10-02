import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app';
import { createAuth } from '../../auth/auth';
import { createAdminInvite } from '../../cli/create-invite';
import { createTempDb, testDatabaseUrl } from '../../test/temp-db';

const appUrl = 'http://localhost:5174';
const TODAY = '2026-10-15';

describe.skipIf(!testDatabaseUrl)('cards and invoices API (integration)', () => {
  let drop: () => Promise<void>;
  let app: ReturnType<typeof buildApp>;
  let cookie: string;
  let spaceId: string;

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
    const me = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie } });
    spaceId = me.json().activeSpaceId;
  });

  afterAll(async () => {
    await app?.close();
    await drop?.();
  });

  const setup = async () => {
    const account = (
      await api('POST', '/accounts', {
        name: 'Conta',
        type: 'checking',
        initialBalance: 500000,
        initialDate: '2026-09-01',
      })
    ).json();
    const card = await api('POST', '/cards', {
      name: 'Nubank',
      brand: 'mastercard',
      limitAmount: 300000,
      closingDay: 3,
      dueDay: 10,
      paymentAccountId: account.id,
    });
    expect(card.statusCode).toBe(201);
    return { account, card: card.json() };
  };

  const buy = (cardId: string, body: Record<string, unknown>) =>
    api('POST', '/transactions', { type: 'expense', description: 'Compra', cardId, ...body });

  const invoice = async (cardId: string, month: string) =>
    (await api('GET', `/cards/${cardId}/invoices/${month}`)).json();

  it('creates a card with its current invoice and limit', async () => {
    const { card } = await setup();
    expect(card).toMatchObject({
      availableLimit: 300000,
      bestPurchaseDay: 3,
      closingDayGoesToNext: true,
      currentInvoice: {
        referenceMonth: '2026-11',
        closingDate: '2026-11-03',
        dueDate: '2026-11-10',
        status: 'open',
        total: 0,
      },
    });
    const bad = await api('POST', '/cards', {
      name: 'X',
      limitAmount: 1,
      closingDay: 32,
      dueDay: 10,
    });
    expect(bad.statusCode).toBe(400);
  });

  it('puts purchases and refunds on the right invoice and tracks the limit', async () => {
    const { card } = await setup();
    // 02/10 é antes do fechamento de 03/10: fatura de outubro.
    const p1 = await buy(card.id, { amount: 100000, date: '2026-10-02' });
    expect(p1.statusCode).toBe(201);
    expect(p1.json()).toMatchObject({ cardId: card.id, accountId: null, paymentMethod: 'credit' });
    // 03/10 (dia do fechamento) já vai para novembro.
    await buy(card.id, { amount: 20000, date: '2026-10-03' });
    await api('POST', '/transactions', {
      type: 'income',
      description: 'Estorno',
      cardId: card.id,
      amount: 5000,
      date: '2026-10-14',
    });

    const oct = await invoice(card.id, '2026-10');
    expect(oct).toMatchObject({
      items: 100000,
      total: 100000,
      status: 'overdue',
      remaining: 100000,
    });
    expect(oct.entries).toHaveLength(1);
    const nov = await invoice(card.id, '2026-11');
    expect(nov).toMatchObject({ items: 15000, total: 15000, status: 'open' });

    const limit = (await api('GET', `/cards/${card.id}/limit`)).json();
    expect(limit).toEqual({ limitAmount: 300000, availableLimit: 300000 - 115000, used: 115000 });

    const list = (await api('GET', `/cards/${card.id}/invoices`)).json();
    expect(list.currentMonth).toBe('2026-11');
    expect(list.items.map((i: { referenceMonth: string }) => i.referenceMonth)).toEqual([
      '2026-12',
      '2026-11',
      '2026-10',
    ]);
    // Conta não muda com compra no cartão.
    const accounts = (await api('GET', '/accounts')).json().items;
    expect(accounts.at(-1).balance).toBe(500000);
  });

  it('pays invoices partially, carries the rest and undoes payments', async () => {
    const { card, account } = await setup();
    await buy(card.id, { amount: 100000, date: '2026-10-01' });
    await buy(card.id, { amount: 30000, date: '2026-10-10' });

    const paid = await api('POST', `/cards/${card.id}/invoices/2026-10/payments`, {
      amount: 40000,
      date: '2026-10-09',
    });
    expect(paid.statusCode).toBe(201);
    // Venceu em 10/10 com pagamento parcial: o resto vira saldo anterior de novembro.
    expect(paid.json()).toMatchObject({ status: 'partial', paid: 40000, remaining: 0 });
    expect(paid.json().payments).toHaveLength(1);
    expect(await invoice(card.id, '2026-11')).toMatchObject({
      carried: 60000,
      items: 30000,
      total: 90000,
      remaining: 90000,
    });
    const acc = (await api('GET', `/accounts/${account.id}`)).json();
    expect(acc.balance).toBe(500000 - 40000);
    const payTx = (await api('GET', `/transactions?accountId=${account.id}`)).json().items[0];
    expect(payTx.description).toBe('Fatura Nubank out/2026');

    // Pagar o total de novembro (padrão: o que falta), antes do fechamento.
    const full = await api('POST', `/cards/${card.id}/invoices/2026-11/payments`, {});
    expect(full.json()).toMatchObject({ paid: 90000, remaining: 0, status: 'open' });
    expect((await api('GET', `/cards/${card.id}/limit`)).json().availableLimit).toBe(300000);

    expect(
      (await api('POST', `/cards/${card.id}/invoices/2026-11/payments`, {})).json().error.code,
    ).toBe('nothing_to_pay');
    expect((await api('PATCH', `/transactions/${payTx.id}`, { amount: 1 })).json().error.code).toBe(
      'invoice_payment_locked',
    );

    // Excluir o lançamento do pagamento desfaz o pagamento.
    expect((await api('DELETE', `/transactions/${payTx.id}`)).statusCode).toBe(204);
    expect(await invoice(card.id, '2026-10')).toMatchObject({ paid: 0, status: 'overdue' });
    const nov = await invoice(card.id, '2026-11');
    expect(nov.carried).toBe(0);
    const payment = nov.payments[0];
    const undone = await api('DELETE', `/cards/${card.id}/invoices/2026-11/payments/${payment.id}`);
    expect(undone.json()).toMatchObject({ paid: 0, payments: [] });
    expect((await api('GET', `/accounts/${account.id}`)).json().balance).toBe(500000);
  });

  it('moves loose purchases when the bank changes the closing date', async () => {
    const { card } = await setup();
    const item = (await buy(card.id, { amount: 1000, date: '2026-10-14' })).json();
    const plan = await invoice(card.id, '2026-11');
    expect(plan.entries.map((e: { id: string }) => e.id)).toContain(item.id);

    const moved = await api('PATCH', `/cards/${card.id}/invoices/2026-11`, {
      closingDateOverride: '2026-10-14',
    });
    expect(moved.json()).toMatchObject({
      closingDate: '2026-10-14',
      closingDateOverride: '2026-10-14',
    });
    expect(moved.json().entries).toHaveLength(0);
    expect((await invoice(card.id, '2026-12')).entries.map((e: { id: string }) => e.id)).toEqual([
      item.id,
    ]);
    expect(
      (
        await api('PATCH', `/cards/${card.id}/invoices/2026-11`, {
          closingDateOverride: '2026-11-20',
        })
      ).json().error.code,
    ).toBe('invalid_invoice_dates');

    // Editar a data de um item avulso também troca a fatura.
    await api('PATCH', `/transactions/${item.id}`, { date: '2026-10-01' });
    expect((await invoice(card.id, '2026-10')).entries.map((e: { id: string }) => e.id)).toEqual([
      item.id,
    ]);
    expect(
      (await api('PATCH', `/transactions/${item.id}`, { accountId: card.paymentAccountId })).json()
        .error.code,
    ).toBe('card_item_field');
  });

  it('validates card purchases and archives cards in use', async () => {
    const { card, account } = await setup();
    const both = await api('POST', '/transactions', {
      type: 'expense',
      description: 'X',
      amount: 1,
      date: '2026-10-01',
      cardId: card.id,
      accountId: account.id,
    });
    expect(both.json().error.code).toBe('validation_error');
    expect((await buy(card.id, { amount: 1, date: '2026-10-20' })).json().error.code).toBe(
      'settled_in_future',
    );
    const planned = await buy(card.id, { amount: 1, date: '2026-10-20', status: 'planned' });
    expect(planned.statusCode).toBe(201);

    expect((await api('DELETE', `/cards/${card.id}`)).json().error.code).toBe(
      'card_has_transactions',
    );
    expect((await api('PATCH', `/cards/${card.id}`, { archived: true })).json().archived).toBe(
      true,
    );
    expect((await buy(card.id, { amount: 1, date: '2026-10-01' })).json().error.code).toBe(
      'card_archived',
    );
    expect((await api('GET', `/cards/${card.id}/invoices/2026-13`)).statusCode).toBe(400);

    const lonely = (
      await api('POST', '/cards', {
        name: 'Sem conta',
        limitAmount: 1000,
        closingDay: 25,
        dueDay: 5,
      })
    ).json();
    expect(lonely.currentInvoice).toMatchObject({
      referenceMonth: '2026-11',
      closingDate: '2026-10-25',
      dueDate: '2026-11-05',
    });
    await buy(lonely.id, { amount: 500, date: '2026-10-15' });
    expect(
      (await api('POST', `/cards/${lonely.id}/invoices/2026-11/payments`, {})).json().error.code,
    ).toBe('account_required');
    const empty = (
      await api('POST', '/cards', { name: 'Vazio', limitAmount: 0, closingDay: 1, dueDay: 8 })
    ).json();
    expect((await api('DELETE', `/cards/${empty.id}`)).statusCode).toBe(204);
  });
});
