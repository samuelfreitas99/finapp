import { and, count, eq, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTempDb, one, testDatabaseUrl } from '../test/temp-db';
import type { Db } from './client';
import { categories, holidays, spaces, users } from './schema';
import { DEFAULT_CATEGORIES, runSeed, SYSTEM_CATEGORIES, seedSpaceCategories } from './seed';

describe.skipIf(!testDatabaseUrl)('seed (integration)', () => {
  let db: Db;
  let drop: () => Promise<void>;

  beforeAll(async () => {
    ({ db, drop } = await createTempDb());
  });

  afterAll(async () => {
    await drop?.();
  });

  const newSpace = async () => {
    const user = one(
      await db
        .insert(users)
        .values({ name: 'Samuel', email: `s-${Math.random().toString(36).slice(2)}@ex.com` })
        .returning(),
    );
    return one(
      await db
        .insert(spaces)
        .values({ name: 'Pessoal', type: 'personal', createdBy: user.id })
        .returning(),
    );
  };

  const categoryCount = async (spaceId: string) =>
    one(
      await db
        .select({ n: count() })
        .from(categories)
        .where(and(eq(categories.spaceId, spaceId), isNull(categories.deletedAt))),
    ).n;

  it('seeds national holidays and backfills categories, idempotently', async () => {
    const space = await newSpace();
    const now = new Date('2026-10-01T12:00:00Z');
    await runSeed(db, now);
    await runSeed(db, now);

    const national = await db.select().from(holidays).where(isNull(holidays.spaceId));
    // 2025 a 2056: 13 feriados por ano (9 fixos + Carnaval 2 + Sexta-feira Santa + Corpus Christi).
    expect(national).toHaveLength(32 * 13);
    expect(national).toContainEqual(
      expect.objectContaining({ date: '2026-09-07', name: 'Independência do Brasil' }),
    );
    expect(national.map((h) => h.date)).toContain('2027-02-08'); // Carnaval 2027

    expect(await categoryCount(space.id)).toBe(
      DEFAULT_CATEGORIES.length + SYSTEM_CATEGORIES.length,
    );
    const system = await db
      .select({ key: categories.systemKey })
      .from(categories)
      .where(and(eq(categories.spaceId, space.id), eq(categories.isSystem, true)));
    expect(system.map((c) => c.key).sort()).toEqual(
      ['adjustment', 'invoice_payment', 'loan', 'transfer'].sort(),
    );
  });

  it('does not recreate default categories the user already customized', async () => {
    const space = await newSpace();
    await db.insert(categories).values({ spaceId: space.id, name: 'Minha', kind: 'expense' });
    await seedSpaceCategories(db, space.id);
    await seedSpaceCategories(db, space.id);
    expect(await categoryCount(space.id)).toBe(1 + SYSTEM_CATEGORIES.length);
  });
});
