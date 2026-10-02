import { REFERENCE_TIME_ZONE, todayIn } from '@finapp/core';
import { PgBoss } from 'pg-boss';
import type { Db } from '../db/client';
import { generateAllRecurrences } from './recurrences';

export const RECURRENCES_JOB = 'recurrences-generate';

/** Erros de conexão derrubada/fechada (57P01 admin_shutdown, pool encerrando). */
export function isConnectionShutdown(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  if (!e) return false;
  if (e.code === '57P01' || e.code === '57P02' || e.code === '57P03') return true;
  return /terminat|pool is ending|after calling end|Connection terminated/i.test(e.message ?? '');
}

interface JobLogger {
  info: (obj: object, msg?: string) => void;
  error: (obj: object, msg?: string) => void;
}

/**
 * Fila de jobs (pg-boss, no mesmo Postgres, schema `pgboss`). Agenda os jobs diários e
 * registra os workers. Desligar com `RUN_JOBS=false`.
 * @see docs/arquitetura.md › Jobs
 */
export async function startJobs({
  db,
  connectionString,
  log,
}: {
  db: Db;
  connectionString: string;
  log: JobLogger;
}): Promise<PgBoss> {
  const boss = new PgBoss({ connectionString, schema: 'pgboss' });
  boss.on('error', (err) => {
    // Conexão encerrada pelo servidor (restart do Postgres, DROP DATABASE nos testes) ou
    // durante o desligamento: o pg-boss reconecta sozinho; não é falha do job.
    if (isConnectionShutdown(err)) return;
    log.error({ err }, 'pg-boss');
  });
  await boss.start();

  await boss.createQueue(RECURRENCES_JOB);
  await boss.schedule(RECURRENCES_JOB, '0 2 * * *', null, {
    tz: REFERENCE_TIME_ZONE,
    missed: 'once',
  });
  await boss.work(RECURRENCES_JOB, async () => {
    const created = await generateAllRecurrences(db, todayIn());
    log.info({ created }, 'recorrências geradas');
  });
  return boss;
}
