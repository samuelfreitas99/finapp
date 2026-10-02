import { createDb } from './client';
import { runSeed } from './seed';

const url = process.env.DATABASE_URL ?? 'postgres://finapp:finapp@127.0.0.1:5433/finapp';
const { db, pool } = createDb(url);
try {
  await runSeed(db);
  console.log('Seed aplicado (feriados nacionais e categorias padrão).');
} finally {
  await pool.end();
}
