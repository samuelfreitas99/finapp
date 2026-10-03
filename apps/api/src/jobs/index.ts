import { REFERENCE_TIME_ZONE, todayIn } from '@finapp/core';
import { PgBoss } from 'pg-boss';
import type { Db } from '../db/client';
import type { PushSender } from '../modules/notifications/push';
import { notifyDueReminders } from '../modules/notifications/reminders';
import { generateAlerts, sendPending } from './alerts';
import { generateSummaries } from './summaries';
import { syncIndexValues } from './indexes';
import { generateAllRecurrences } from './recurrences';

export const RECURRENCES_JOB = 'recurrences-generate';
export const ALERTS_JOB = 'alerts-daily';
export const SEND_JOB = 'notifications-send';
export const INDEXES_JOB = 'indexes-sync';

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
  push = null,
}: {
  db: Db;
  connectionString: string;
  log: JobLogger;
  push?: PushSender | null;
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

  // Índices de correção (INCC, IPCA, IGP-M) do Banco Central e do IBGE, uma vez por dia
  // (e na subida, para recuperar o que ficou para trás). Falha de rede só vai para o log.
  await boss.createQueue(INDEXES_JOB);
  // Duas vezes por dia: se a fonte estiver fora do ar de manhã, tenta de novo à tarde.
  await boss.schedule(INDEXES_JOB, '30 9,15 * * *', null, {
    tz: REFERENCE_TIME_ZONE,
    missed: 'once',
  });
  const runIndexSync = async () => {
    const r = await syncIndexValues(db, todayIn());
    log.info({ saved: r.saved, errors: r.errors }, 'índices atualizados');
  };
  await boss.work(INDEXES_JOB, runIndexSync);
  // Na subida também, sem atrasar o início da API; falha só vai para o log.
  void runIndexSync().catch((err) => log.error({ err }, 'índices: falha na busca inicial'));

  // Alertas do dia às 08:00; o envio roda de hora em hora para o que ficou no silêncio.
  await boss.createQueue(ALERTS_JOB);
  await boss.schedule(ALERTS_JOB, '0 8 * * *', null, { tz: REFERENCE_TIME_ZONE, missed: 'once' });
  await boss.work(ALERTS_JOB, async () => {
    const created =
      (await generateAlerts(db, todayIn())) + (await generateSummaries(db, todayIn()));
    const sent = await sendPending(db, push);
    log.info({ created, sent }, 'alertas do dia');
  });
  await boss.createQueue(SEND_JOB);
  // A cada 5 minutos: lembretes que chegaram no horário + o que ficou no silêncio.
  await boss.schedule(SEND_JOB, '*/5 * * * *', null, { tz: REFERENCE_TIME_ZONE });
  await boss.work(SEND_JOB, async () => {
    await notifyDueReminders(db);
    const sent = await sendPending(db, push);
    if (sent) log.info({ sent }, 'notificações enviadas');
  });
  return boss;
}
