import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { createDb, type Db } from '../db/client';
import { runMigrations } from '../db/migrate';

/** URL do Postgres para testes de integração; sem ela, os testes são pulados. */
export const testDatabaseUrl = process.env.DATABASE_URL;

/**
 * Cria um banco temporário no servidor de `DATABASE_URL`, aplica as migrações e
 * devolve o cliente e a função de limpeza. Feche o app (Fastify) antes de chamar
 * `drop()`: ela encerra o pool e só depois apaga o banco.
 */
export async function createTempDb(): Promise<{ db: Db; url: string; drop: () => Promise<void> }> {
  if (!testDatabaseUrl) throw new Error('DATABASE_URL não definido');
  const name = `finapp_test_${randomBytes(4).toString('hex')}`;
  const admin = new pg.Client({ connectionString: testDatabaseUrl });
  admin.on('error', () => undefined);
  await admin.connect();
  await admin.query(`create database ${name}`);
  const url = new URL(testDatabaseUrl);
  url.pathname = `/${name}`;
  await runMigrations(url.toString());
  const { db, pool } = createDb(url.toString());
  return {
    db,
    url: url.toString(),
    drop: async () => {
      await pool.end();
      try {
        await admin.query(`drop database if exists ${name} with (force)`);
      } finally {
        await admin.end();
      }
    },
  };
}

/** Primeira linha de um `returning()`, falhando se vier vazio. */
export function one<T>(rows: T[]): T {
  const [row] = rows;
  if (row === undefined) throw new Error('nenhuma linha retornada');
  return row;
}
