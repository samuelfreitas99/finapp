import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from './client';
import { runMigrations } from './migrate';
import { accounts, holidays, spaceMembers, spaces, transactions, users } from './schema';

/**
 * Teste de integração do schema: cria um banco temporário no Postgres de
 * `DATABASE_URL` (o de dev, ou o serviço do CI), aplica as migrações e confere as
 * restrições. Pulado se `DATABASE_URL` não estiver definido.
 */
const baseUrl = process.env.DATABASE_URL;

function one<T>(rows: T[]): T {
  const [row] = rows;
  if (row === undefined) throw new Error('nenhuma linha retornada');
  return row;
}

describe.skipIf(!baseUrl)('database schema (integration)', () => {
  const dbName = `finapp_test_${randomBytes(4).toString('hex')}`;
  let admin: pg.Client;
  let db: Db;
  let pool: pg.Pool;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: baseUrl });
    await admin.connect();
    await admin.query(`create database ${dbName}`);
    const url = new URL(baseUrl as string);
    url.pathname = `/${dbName}`;
    await runMigrations(url.toString());
    ({ db, pool } = createDb(url.toString()));
  });

  afterAll(async () => {
    await pool?.end();
    await admin?.query(`drop database if exists ${dbName} with (force)`);
    await admin?.end();
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
