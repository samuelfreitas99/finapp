import { existsSync } from 'node:fs';
import fastifyStatic from '@fastify/static';
import type { HealthResponse } from '@finapp/shared';
import Fastify, { type FastifyServerOptions } from 'fastify';

export interface AppOptions {
  /** Pasta com o build do front (apps/web/dist). Se existir, é servida em `/`. */
  webDist?: string | undefined;
  logger?: FastifyServerOptions['logger'];
}

export function buildApp({ webDist, logger = false }: AppOptions = {}) {
  const app = Fastify({ logger });

  app.get('/api/health', async (): Promise<HealthResponse> => {
    return { status: 'ok', time: new Date().toISOString() };
  });

  const serveWeb = webDist !== undefined && existsSync(webDist);
  if (serveWeb) {
    app.register(fastifyStatic, { root: webDist, wildcard: false });
  }

  app.setNotFoundHandler((request, reply) => {
    if (serveWeb && request.method === 'GET' && !request.url.startsWith('/api')) {
      // SPA: rotas do front caem no index.html.
      return reply.sendFile('index.html');
    }
    return reply.code(404).send({ error: { code: 'not_found', message: 'Rota não encontrada' } });
  });

  return app;
}
