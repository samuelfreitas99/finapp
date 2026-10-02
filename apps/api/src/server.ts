import { buildApp } from './app';

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? '127.0.0.1';

const app = buildApp({
  webDist: process.env.WEB_DIST,
  logger: { level: process.env.LOG_LEVEL ?? 'info' },
});

const shutdown = async () => {
  await app.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

app.listen({ port, host }).catch((err: unknown) => {
  app.log.error(err);
  process.exit(1);
});
