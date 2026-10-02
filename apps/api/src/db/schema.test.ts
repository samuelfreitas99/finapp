import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTempDb, one, testDatabaseUrl } from '../test/temp-db';
import type { Db } from './client';
import { accounts, holidays, spaceMembers, spaces, transactions, users } from './schema';

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
});
