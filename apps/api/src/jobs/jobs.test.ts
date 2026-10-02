import { randomBytes } from 'node:crypto';
import { and, count, eq, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../db/client';
import { accounts, recurrences, spaces, transactions, users } from '../db/schema';
import { createTempDb, one, testDatabaseUrl } from '../test/temp-db';
import { RECURRENCES_JOB, startJobs } from './index';
import { generateAllRecurrences } from './recurrences';

describe.skipIf(!testDatabaseUrl)('jobs (integration)', () => {
  let db: Db;
  let url: string;
  let drop: () => Promise<void>;

  beforeAll(async () => {
    ({ db, url, drop } = await createTempDb());
  });

  afterAll(async () => {
    await drop?.();
  });

  const occurrences = async (recurrenceId: string) =>
    one(
      await db
        .select({ n: count() })
        .from(transactions)
        .where(and(eq(transactions.recurrenceId, recurrenceId), isNull(transactions.deletedAt))),
    ).n;

  it('extends the 12-month window of every active recurrence, idempotently', async () => {
    const user = one(
      await db
        .insert(users)
        .values({ name: 'S', email: `s-${randomBytes(3).toString('hex')}@ex.com` })
        .returning(),
    );
    const space = one(
      await db
        .insert(spaces)
        .values({ name: 'P', type: 'personal', createdBy: user.id })
        .returning(),
    );
    const account = one(
      await db
        .insert(accounts)
        .values({ spaceId: space.id, name: 'C', type: 'checking', initialDate: '2026-01-01' })
        .returning(),
    );
    const base = {
      spaceId: space.id,
      type: 'expense' as const,
      description: 'Aluguel',
      amount: 150000,
      frequency: 'monthly' as const,
      dayRule: { kind: 'fixed_day' as const, day: 5 },
      startDate: '2026-10-01',
      accountId: account.id,
    };
    const rec = one(await db.insert(recurrences).values(base).returning());
    const ended = one(
      await db
        .insert(recurrences)
        .values({ ...base, description: 'Antiga', startDate: '2026-01-01', endDate: '2026-06-30' })
        .returning(),
    );

    // out/2026 a out/2027.
    expect(await generateAllRecurrences(db, '2026-10-15')).toBe(13);
    expect(await generateAllRecurrences(db, '2026-10-15')).toBe(0);
    // Um mês depois, a janela anda: entra nov/2027.
    expect(await generateAllRecurrences(db, '2026-11-15')).toBe(1);
    expect(await occurrences(rec.id)).toBe(14);
    expect(await occurrences(ended.id)).toBe(0);
    const [updated] = await db.select().from(recurrences).where(eq(recurrences.id, rec.id));
    expect(updated?.generatedUntil).toBe('2027-11-30');
  });

  it('starts pg-boss and schedules the daily generation', async () => {
    const logs: string[] = [];
    const boss = await startJobs({
      db,
      connectionString: url,
      log: {
        info: (_o, msg) => logs.push(msg ?? ''),
        error: (_o, msg) => logs.push(`erro ${msg}`),
      },
    });
    try {
      const schedules = await boss.getSchedules();
      expect(schedules.map((s) => s.name)).toContain(RECURRENCES_JOB);
      expect(schedules.find((s) => s.name === RECURRENCES_JOB)).toMatchObject({
        cron: '0 2 * * *',
        options: expect.objectContaining({ tz: 'America/Sao_Paulo' }),
      });
    } finally {
      await boss.stop({ graceful: false });
    }
    expect(logs.filter((l) => l.startsWith('erro'))).toEqual([]);
  });
});
