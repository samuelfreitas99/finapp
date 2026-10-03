import { buildApp } from './app';
import { createAuth } from './auth/auth';
import { createAdminInvite } from './cli/create-invite';
import { createResetLink } from './cli/reset-link';
import { createMailer } from './mail';
import { loadConfig } from './config';
import { createPushSender } from './modules/notifications/push';
import { createDb } from './db/client';
import { runMigrations } from './db/migrate';
import { runSeed } from './db/seed';
import { startJobs } from './jobs';
import { generateAllRecurrences } from './jobs/recurrences';
import { todayIn } from '@finapp/core';

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? '127.0.0.1';
const config = loadConfig();

async function main() {
  // `node server.cjs --create-invite [dias]`: cria um convite de administrador e sai.
  const inviteFlag = process.argv.indexOf('--create-invite');
  if (inviteFlag !== -1) {
    if (!config.databaseUrl) throw new Error('DATABASE_URL não definido');
    const days = Number(process.argv[inviteFlag + 1] ?? 7);
    console.log(
      `Convite: ${await createAdminInvite(config.databaseUrl, days)} (vale ${days} dias)`,
    );
    return;
  }

  // `node server.cjs --reset-link email`: link para a pessoa escolher uma senha nova.
  const resetFlag = process.argv.indexOf('--reset-link');
  if (resetFlag !== -1) {
    if (!config.databaseUrl) throw new Error('DATABASE_URL não definido');
    const email = process.argv[resetFlag + 1] ?? '';
    const link = await createResetLink(config.databaseUrl, config.appUrl, email);
    console.log(link ? `Link (vale 24 h): ${link}` : `Nenhuma conta com o e-mail ${email}.`);
    return;
  }

  const mailer = config.mail ? createMailer(config.mail) : null;
  let db;
  let auth;
  if (config.databaseUrl) {
    if (process.env.RUN_MIGRATIONS !== 'false') await runMigrations(config.databaseUrl);
    db = createDb(config.databaseUrl).db;
    if (process.env.RUN_SEED !== 'false') await runSeed(db);
    auth = createAuth({
      db,
      secret: config.authSecret ?? 'dev-secret-dev-secret-dev-secret-0000',
      appUrl: config.appUrl,
      production: config.production,
      mailer,
    });
  }

  const push = db && config.push ? createPushSender(db, config.push) : null;
  const app = buildApp({
    push,
    webDist: process.env.WEB_DIST,
    logger: { level: process.env.LOG_LEVEL ?? 'info' },
    ...(db && auth ? { db, auth } : {}),
    appUrl: config.appUrl,
    redirectHosts: config.redirectHosts,
    passwordResetEmail: Boolean(mailer),
  });

  let boss: Awaited<ReturnType<typeof startJobs>> | null = null;
  if (db && config.databaseUrl && process.env.RUN_JOBS !== 'false') {
    boss = await startJobs({ db, connectionString: config.databaseUrl, log: app.log, push });
    // Na subida, já completa a janela (o job diário roda às 02:00).
    generateAllRecurrences(db, todayIn()).catch((err: unknown) =>
      app.log.error({ err }, 'falha ao gerar recorrências'),
    );
  }

  const shutdown = async () => {
    await boss?.stop();
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  if (!db) app.log.warn('DATABASE_URL não definido: rodando sem banco e sem autenticação.');
  await app.listen({ port, host });
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
