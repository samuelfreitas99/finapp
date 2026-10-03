import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app';
import { createAuth } from '../../auth/auth';
import { createAdminInvite } from '../../cli/create-invite';
import { createTempDb, testDatabaseUrl } from '../../test/temp-db';

const appUrl = 'http://localhost:5174';
const TODAY = '2026-10-15';

describe.skipIf(!testDatabaseUrl)('import API (integration)', () => {
  let drop: () => Promise<void>;
  let app: ReturnType<typeof buildApp>;
  let cookie: string;
  let spaceId: string;
  let accountId: string;
  let market: string;
  let salary: string;

  type Method = 'GET' | 'POST' | 'DELETE';
  const api = (method: Method, path: string, payload?: unknown) =>
    app.inject({
      method,
      url: `/api/spaces/${spaceId}${path}`,
      headers: { cookie, origin: appUrl },
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });

  const OFX = `<OFX><BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261003<TRNAMT>-45.90<FITID>a1<MEMO>COMPRA MERCADO SOL</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261005<TRNAMT>3500.00<FITID>b2<MEMO>SALARIO EMPRESA</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261006<TRNAMT>-80.00<FITID>c3<MEMO>PADARIA</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20251231<TRNAMT>-10.00<FITID>d4<MEMO>ANTIGO</STMTTRN>
</BANKTRANLIST></OFX>`;

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
        initialBalance: 100000,
        initialDate: '2026-01-01',
      })
    ).json().id;
    const expense = (await api('GET', '/categories?kind=expense')).json().items;
    const income = (await api('GET', '/categories?kind=income')).json().items;
    market = expense[0].id;
    salary = income[0].id;
  });

  afterAll(async () => {
    await app?.close();
    await drop?.();
  });

  const preview = (content: string, format = 'ofx') =>
    api('POST', '/import/preview', { accountId, format, content });

  it('previews an OFX statement and flags rows before the account start', async () => {
    const res = await preview(OFX);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.counts).toEqual({ total: 4, exact: 0, possible: 0, ready: 3, matched: 0 });
    expect(body.rows[0]).toMatchObject({ type: 'expense', amount: 4590, importKey: 'fit:a1' });
    expect(body.rows[1]).toMatchObject({ type: 'income', amount: 350000 });
    expect(body.rows[3].beforeInitialDate).toBe(true);
  });

  it('rejects unreadable files with a helpful message', async () => {
    const res = await preview('foo;bar\n1;2', 'csv');
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('invalid_statement');
    expect(res.json().error.message).toMatch(/foo, bar/);
  });

  it('imports once, remembers the category rule and skips repeats', async () => {
    const rows = (await preview(OFX)).json().rows as {
      date: string;
      type: string;
      amount: number;
      description: string;
      importKey: string;
    }[];
    const items = rows.slice(0, 3).map((r) => ({
      ...r,
      categoryId: r.description.includes('MERCADO') ? market : r.type === 'income' ? salary : null,
      saveRule: r.description.includes('MERCADO'),
    }));
    const done = await api('POST', '/import/commit', { accountId, items });
    expect(done.statusCode).toBe(200);
    expect(done.json()).toEqual({
      created: 3,
      confirmed: 0,
      linked: 0,
      skipped: 0,
      rulesCreated: 1,
    });

    const txs = (await api('GET', '/transactions?limit=50')).json().items as {
      description: string;
      status: string;
      categoryId: string | null;
    }[];
    expect(txs).toHaveLength(3);
    expect(txs.every((t) => t.status === 'settled')).toBe(true);

    const again = await preview(OFX);
    expect(again.json().counts).toMatchObject({ exact: 3, ready: 0 });
    const twice = await api('POST', '/import/commit', { accountId, items });
    expect(twice.json()).toEqual({
      created: 0,
      confirmed: 0,
      linked: 0,
      skipped: 3,
      rulesCreated: 0,
    });
  });

  it('applies saved rules on the next preview, per kind', async () => {
    const csv =
      'Data;Descrição;Valor\n10/10/2026;Compra Mercado Sol 99;-12,00\n10/10/2026;Mercado Sol estorno;12,00';
    const rows = (await preview(csv, 'csv')).json().rows;
    expect(rows[0]).toMatchObject({ type: 'expense', categoryId: market });
    // A regra é de despesa: a receita com o mesmo trecho não recebe a categoria.
    expect(rows[1]).toMatchObject({ type: 'income', categoryId: null });
  });

  it('links a hand-entered transaction instead of duplicating it', async () => {
    const manual = await api('POST', '/transactions', {
      type: 'expense',
      status: 'settled',
      amount: 3300,
      date: '2026-10-12',
      description: 'Almoço',
      accountId,
    });
    expect(manual.statusCode, manual.body).toBe(201);
    const csv = 'Data;Descrição;Valor\n13/10/2026;ALMOCO RESTAURANTE;-33,00';
    const rows = (await preview(csv, 'csv')).json().rows;
    expect(rows[0].duplicate).toBeNull();
    expect(rows[0].match).toMatchObject({
      id: manual.json().id,
      kind: 'settled',
      description: 'Almoço',
    });
    const res = (
      await api('POST', '/import/commit', {
        accountId,
        items: [{ ...rows[0], matchId: rows[0].match.id }],
      })
    ).json();
    expect(res).toMatchObject({ created: 0, linked: 1, confirmed: 0 });
    // Importar o mesmo extrato de novo: agora é reconhecido na hora.
    expect((await preview(csv, 'csv')).json().rows[0].duplicate).toBe('exact');
  });

  it('confirms planned items (salary, debt installment) with the real amount and date', async () => {
    const salary = await api('POST', '/transactions', {
      type: 'income',
      status: 'planned',
      amount: 500000,
      date: '2026-10-07',
      description: 'Salário',
      accountId,
    });
    expect(salary.statusCode, salary.body).toBe(201);
    const debt = (
      await api('POST', '/debts', {
        name: 'Empréstimo extrato',
        kind: 'bank_loan',
        paymentAccountId: accountId,
        phases: [
          {
            system: 'fixed',
            installments: 1,
            installmentAmount: 30000,
            firstDueDate: '2026-10-09',
          },
        ],
      })
    ).json();
    const csv = [
      'Data;Descrição;Valor',
      '05/10/2026;PAGTO SALARIO EMPRESA;5000,00',
      '09/10/2026;DEBITO EMPRESTIMO;-300,00',
      '09/10/2026;OUTRA COISA;-12,00',
    ].join('\n');
    const preview1 = (await preview(csv, 'csv')).json();
    const [sal, loan, other] = preview1.rows;
    expect(sal.match).toMatchObject({ id: salary.json().id, kind: 'planned' });
    expect(loan.match).toMatchObject({ kind: 'planned', amount: 30000 });
    expect(other.match).toBeNull();
    expect(preview1.counts.matched).toBe(2);

    const res = (
      await api('POST', '/import/commit', {
        accountId,
        items: preview1.rows.map((r: { match: { id: string } | null }) => ({
          ...r,
          matchId: r.match?.id ?? null,
        })),
      })
    ).json();
    expect(res).toMatchObject({ created: 1, confirmed: 2, linked: 0 });
    const tx = (await api('GET', `/transactions/${salary.json().id}`)).json();
    expect(tx).toMatchObject({ status: 'settled', date: '2026-10-05', amount: 500000 });
    expect((await api('GET', `/debts/${debt.id}`)).json().status).toBe('paid_off');
  });

  it('confirms a booklet installment paid late with interest (different amount)', async () => {
    const debt = (
      await api('POST', '/debts', {
        name: 'Entrada construtora',
        kind: 'other',
        paymentAccountId: accountId,
        phases: [
          {
            system: 'fixed',
            installments: 2,
            installmentAmount: 50000,
            firstDueDate: '2026-10-01',
          },
        ],
      })
    ).json();
    // Pago 8 dias depois, com R$ 10 de juros.
    const csv = 'Data;Descrição;Valor\n09/10/2026;PAGTO BOLETO CONSTRUTORA;-510,00';
    const pre = (await preview(csv, 'csv')).json();
    expect(pre.rows[0].match).toMatchObject({ kind: 'planned', amount: 50000 });
    await api('POST', '/import/commit', {
      accountId,
      items: [{ ...pre.rows[0], matchId: pre.rows[0].match.id }],
    });
    const after = (await api('GET', `/debts/${debt.id}`)).json();
    expect(after.installments[0]).toMatchObject({ status: 'paid', paidAmount: 51000 });
    expect(after.installments[1].status).toBe('pending');
  });

  it('imports a card invoice CSV into the chosen invoice, without duplicating', async () => {
    const cardId = (
      await api('POST', '/cards', {
        name: 'Nubank',
        limitAmount: 1000000,
        closingDay: 3,
        dueDay: 10,
      })
    ).json().id;
    // Parcelado e compra feita à mão que já estão na fatura de novembro.
    await api('POST', '/installment-plans', {
      description: 'Geladeira',
      cardId,
      totalAmount: 10000,
      installments: 3,
      firstDate: '2026-10-14',
    });
    const manual = await api('POST', '/transactions', {
      type: 'expense',
      amount: 5290,
      date: '2026-10-12',
      description: 'Mercado',
      cardId,
    });
    expect(manual.statusCode, manual.body).toBe(201);

    // Fatura do Nubank: compra positiva, pagamento negativo; datas da compra original.
    const csv = [
      'date,title,amount',
      '2026-10-14,Geladeira - Parcela 1/3,33.34',
      '2026-10-12,Mercado Sol,52.90',
      '2026-10-13,Farmacia,20.00',
      '2026-10-05,Pagamento recebido,-500.00',
    ].join('\n');
    const body = { cardId, invoiceMonth: '2026-11', format: 'csv', content: csv, invert: true };
    const pre = (await api('POST', '/import/preview', body)).json();
    expect(pre.counts).toMatchObject({ total: 4, matched: 2, ready: 3 });
    const [plan, market, pharmacy, payment] = pre.rows;
    expect(plan).toMatchObject({ type: 'expense', amount: 3334, match: { kind: 'settled' } });
    expect(market.match).toMatchObject({ id: manual.json().id, kind: 'settled' });
    expect(pharmacy).toMatchObject({ type: 'expense', amount: 2000, match: null });
    expect(payment).toMatchObject({ invoicePayment: true, match: null });

    const res = (
      await api('POST', '/import/commit', {
        cardId,
        invoiceMonth: '2026-11',
        items: pre.rows
          .filter((r: { invoicePayment: boolean }) => !r.invoicePayment)
          .map((r: { match: { id: string } | null }) => ({ ...r, matchId: r.match?.id ?? null })),
      })
    ).json();
    expect(res).toMatchObject({ created: 1, linked: 2, confirmed: 0 });
    const invoice = (await api('GET', `/cards/${cardId}/invoices/2026-11`)).json();
    expect(invoice.total).toBe(3334 + 5290 + 2000);

    const again = (await api('POST', '/import/preview', body)).json();
    expect(again.counts).toMatchObject({ exact: 3, ready: 0 });
    // Fatura exige o mês; conta e cartão juntos não.
    expect(
      (await api('POST', '/import/preview', { ...body, invoiceMonth: undefined })).statusCode,
    ).toBe(400);
    expect((await api('POST', '/import/preview', { ...body, accountId })).statusCode).toBe(400);
  });

  it('does not bring back an imported transaction that was deleted', async () => {
    const txs = (await api('GET', '/transactions?limit=50&q=PADARIA')).json().items;
    expect((await api('DELETE', `/transactions/${txs[0].id}`)).statusCode).toBe(204);
    const counts = (await preview(OFX)).json().counts;
    expect(counts.exact).toBe(3);
  });

  it('validates category kind and manages rules', async () => {
    const bad = await api('POST', '/import/commit', {
      accountId,
      items: [
        {
          date: '2026-10-20',
          type: 'income',
          amount: 100,
          description: 'X',
          importKey: 'k1',
          categoryId: market,
        },
      ],
    });
    expect(bad.statusCode).toBe(400);

    const created = await api('POST', '/category-rules', {
      pattern: 'Padaria Pão',
      categoryId: market,
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().pattern).toBe('padaria pao');
    const list = (await api('GET', '/category-rules')).json().items;
    expect(list.map((r: { pattern: string }) => r.pattern)).toEqual([
      'compra mercado sol',
      'padaria pao',
    ]);
    expect((await api('DELETE', `/category-rules/${created.json().id}`)).statusCode).toBe(204);
    expect((await api('DELETE', `/category-rules/${created.json().id}`)).statusCode).toBe(404);
  });
});
