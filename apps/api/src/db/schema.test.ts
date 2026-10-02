import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTempDb, one, testDatabaseUrl } from '../test/temp-db';
import type { Db } from './client';
import {
  accounts,
  creditCards,
  holidays,
  installmentPlans,
  invoicePayments,
  invoices,
  spaceMembers,
  spaces,
  transactions,
  users,
} from './schema';

/**
 * Teste de integração do schema: banco temporário com as migrações aplicadas.
 * Pulado se `DATABASE_URL` não estiver definido.
 */
describe.skipIf(!testDatabaseUrl)('database schema (integration)', () => {
  let db: Db;
  let drop: () => Promise<void>;

  beforeAll(async () => {
    ({ db, drop } = await createTempDb());
  });

  afterAll(async () => {
    await drop?.();
  });

  async function seed() {
    const user = one(
      await db
        .insert(users)
        .values({ name: 'Samuel', email: `s-${randomBytes(3).toString('hex')}@ex.com` })
        .returning(),
    );
    const space = one(
      await db
        .insert(spaces)
        .values({ name: 'Pessoal', type: 'personal', createdBy: user.id })
        .returning(),
    );
    await db.insert(spaceMembers).values({ spaceId: space.id, userId: user.id, role: 'owner' });
    const account = one(
      await db
        .insert(accounts)
        .values({
          spaceId: space.id,
          name: 'Nubank',
          type: 'checking',
          initialBalance: 123456,
          initialDate: '2026-10-01',
        })
        .returning(),
    );
    return { user, space, account };
  }

  it('stores money as integer cents and dates as YYYY-MM-DD', async () => {
    const { space, account } = await seed();
    const tx = one(
      await db
        .insert(transactions)
        .values({
          spaceId: space.id,
          type: 'expense',
          status: 'settled',
          amount: 9_007_199_254_740,
          date: '2026-10-07',
          description: 'Teste',
          accountId: account.id,
        })
        .returning(),
    );
    expect(tx.amount).toBe(9_007_199_254_740);
    expect(tx.date).toBe('2026-10-07');
    expect(account.initialBalance).toBe(123456);
    expect(tx.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('rejects invalid enums, non-positive amounts and missing account/invoice', async () => {
    const { space, account } = await seed();
    const base = {
      spaceId: space.id,
      type: 'expense' as const,
      status: 'planned' as const,
      amount: 100,
      date: '2026-10-07',
      description: 'x',
      accountId: account.id,
    };
    await expect(db.insert(transactions).values({ ...base, amount: 0 })).rejects.toThrow();
    await expect(db.insert(transactions).values({ ...base, accountId: null })).rejects.toThrow();
    await expect(
      db
        .insert(transactions)
        .values({ ...base, invoiceId: '01900000-0000-7000-8000-000000000000' }),
    ).rejects.toThrow();
    await expect(
      db.execute(sql`insert into transactions (id, space_id, type, status, amount, date, description, account_id)
        values (gen_random_uuid(), ${space.id}, 'gift', 'planned', 1, '2026-10-07', 'x', ${account.id})`),
    ).rejects.toThrow();
  });

  it('keeps one national holiday per date', async () => {
    await db.insert(holidays).values({ date: '2026-09-07', name: 'Independência' });
    await expect(
      db.insert(holidays).values({ date: '2026-09-07', name: 'Duplicado' }),
    ).rejects.toThrow();
  });

  it('links card purchases to invoices and installment plans (RN 4, 5)', async () => {
    const { space, account } = await seed();
    const card = one(
      await db
        .insert(creditCards)
        .values({
          spaceId: space.id,
          name: 'Nubank',
          limitAmount: 500000,
          closingDay: 3,
          dueDay: 10,
          paymentAccountId: account.id,
        })
        .returning(),
    );
    expect(card.closingDayGoesToNext).toBe(true);
    const invoice = one(
      await db
        .insert(invoices)
        .values({
          spaceId: space.id,
          cardId: card.id,
          referenceMonth: '2026-10',
          closingDate: '2026-10-03',
          dueDate: '2026-10-10',
        })
        .returning(),
    );
    expect(invoice.status).toBe('open');
    const plan = one(
      await db
        .insert(installmentPlans)
        .values({
          spaceId: space.id,
          description: 'Geladeira',
          totalAmount: 10000,
          installments: 3,
          firstDate: '2026-10-02',
          cardId: card.id,
        })
        .returning(),
    );
    const item = one(
      await db
        .insert(transactions)
        .values({
          spaceId: space.id,
          type: 'expense',
          status: 'planned',
          amount: 3334,
          date: '2026-10-02',
          description: 'Geladeira 1/3',
          invoiceId: invoice.id,
          cardId: card.id,
          installmentPlanId: plan.id,
          installmentNumber: 1,
        })
        .returning(),
    );
    expect(item.anticipated).toBe(false);
    const payment = one(
      await db
        .insert(invoicePayments)
        .values({
          spaceId: space.id,
          invoiceId: invoice.id,
          accountId: account.id,
          amount: 3334,
          date: '2026-10-10',
        })
        .returning(),
    );
    expect(payment.amount).toBe(3334);
  });

  it('rejects invalid cards, invoices, payments and plans', async () => {
    const { space, account } = await seed();
    const cardBase = { spaceId: space.id, name: 'C', limitAmount: 100, closingDay: 3, dueDay: 10 };
    await expect(db.insert(creditCards).values({ ...cardBase, closingDay: 32 })).rejects.toThrow();
    await expect(db.insert(creditCards).values({ ...cardBase, dueDay: 0 })).rejects.toThrow();
    await expect(db.insert(creditCards).values({ ...cardBase, limitAmount: -1 })).rejects.toThrow();
    const card = one(await db.insert(creditCards).values(cardBase).returning());

    const invBase = {
      spaceId: space.id,
      cardId: card.id,
      referenceMonth: '2026-11',
      closingDate: '2026-11-03',
      dueDate: '2026-11-10',
    };
    await expect(
      db.insert(invoices).values({ ...invBase, referenceMonth: '2026-13' }),
    ).rejects.toThrow();
    await expect(
      db.insert(invoices).values({ ...invBase, closingDate: '2026-11-20' }),
    ).rejects.toThrow();
    const invoice = one(await db.insert(invoices).values(invBase).returning());
    await expect(db.insert(invoices).values(invBase)).rejects.toThrow(); // um por mês

    await expect(
      db.insert(invoicePayments).values({
        spaceId: space.id,
        invoiceId: invoice.id,
        accountId: account.id,
        amount: 0,
        date: '2026-11-10',
      }),
    ).rejects.toThrow();

    const planBase = {
      spaceId: space.id,
      description: 'P',
      totalAmount: 1000,
      installments: 10,
      firstDate: '2026-10-02',
    };
    await expect(db.insert(installmentPlans).values(planBase)).rejects.toThrow(); // nem cartão nem conta
    await expect(
      db.insert(installmentPlans).values({ ...planBase, cardId: card.id, accountId: account.id }),
    ).rejects.toThrow();
    await expect(
      db.insert(installmentPlans).values({ ...planBase, cardId: card.id, startInstallment: 11 }),
    ).rejects.toThrow();
    await expect(
      db.insert(transactions).values({
        spaceId: space.id,
        type: 'expense',
        status: 'planned',
        amount: 100,
        date: '2026-10-02',
        description: 'x',
        accountId: account.id,
        installmentNumber: 2,
      }),
    ).rejects.toThrow(); // número sem plano
  });
});
