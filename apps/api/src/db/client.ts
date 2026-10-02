import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema';

// `date` como texto `YYYY-MM-DD` (sem fuso) e `bigint` (int8) como number.
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => {
  const n = Number(v);
  if (!Number.isSafeInteger(n)) throw new RangeError(`int8 fora do intervalo seguro: ${v}`);
  return n;
});

export function createDb(connectionString: string) {
  const pool = new pg.Pool({ connectionString, max: 10 });
  // Conexão ociosa derrubada pelo servidor (restart do Postgres, DROP DATABASE nos
  // testes): sem este listener o `pg` transforma o erro em exceção não tratada e
  // derruba o processo. O pool descarta o cliente e abre outro na próxima consulta.
  pool.on('error', (err) => {
    if ((err as { code?: string }).code === '57P01') return; // admin_shutdown
    console.error('Erro em conexão ociosa do Postgres:', err.message);
  });
  return { db: drizzle(pool, { schema }), pool };
}

export type Db = ReturnType<typeof createDb>['db'];
