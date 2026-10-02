import { buildApp } from './app';
import { createAuth } from './auth/auth';
import { createAdminInvite } from './cli/create-invite';
import { loadConfig } from './config';
import { createDb } from './db/client';
import { runMigrations } from './db/migrate';
import { runSeed } from './db/seed';

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
    });
  }

  const app = buildApp({
    webDist: process.env.WEB_DIST,
    logger: { level: process.env.LOG_LEVEL ?? 'info' },
    ...(db && auth ? { db, auth } : {}),
    appUrl: config.appUrl,
  });

  const shutdown = async () => {
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
