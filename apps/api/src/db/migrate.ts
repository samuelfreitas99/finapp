import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb } from './client';

/** Pasta das migrações (ao lado deste arquivo em dev; `MIGRATIONS_DIR` no bundle). */
export const defaultMigrationsDir =
  process.env.MIGRATIONS_DIR ?? fileURLToPath(new URL('./migrations', import.meta.url));

/** Aplica as migrações pendentes. */
export async function runMigrations(
  connectionString: string,
  migrationsFolder = defaultMigrationsDir,
) {
  const { db, pool } = createDb(connectionString);
  try {
    await migrate(db, { migrationsFolder });
  } finally {
    await pool.end();
  }
}
