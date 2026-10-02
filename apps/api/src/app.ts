import { existsSync } from 'node:fs';
import fastifyStatic from '@fastify/static';
import { todayIn, type ISODate } from '@finapp/core';
import type { HealthResponse } from '@finapp/shared';
import Fastify, { type FastifyServerOptions } from 'fastify';
import { ZodError } from 'zod';
import type { Auth } from './auth/auth';
import type { Db } from './db/client';
import { ApiError } from './http/errors';
import { accountRoutes } from './modules/accounts/routes';
import { categoryRoutes } from './modules/categories/routes';
import { spaceScoped } from './modules/spaces/scope';
import { transactionRoutes } from './modules/transactions/routes';
import { inviteRoutes } from './modules/invites/routes';
import { meRoutes } from './modules/me/routes';
import { registerAuth } from './plugins/auth';

export interface AppOptions {
  /** Pasta com o build do front (apps/web/dist). Se existir, é servida em `/`. */
  webDist?: string | undefined;
  logger?: FastifyServerOptions['logger'];
  /** Banco e autenticação. Sem eles, só a rota de saúde e o front (útil em testes). */
  db?: Db;
  auth?: Auth;
  appUrl?: string;
  /** "Hoje" (YYYY-MM-DD, America/Sao_Paulo). Injetável nos testes. */
  today?: () => ISODate;
}

export function buildApp({
  webDist,
  logger = false,
  db,
  auth,
  appUrl = 'http://localhost:5174',
  today = () => todayIn(),
}: AppOptions = {}) {
  const app = Fastify({ logger, trustProxy: true });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError) {
      return reply
        .code(error.statusCode)
        .send({ error: { code: error.code, message: error.message } });
    }
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: { code: 'validation_error', message: 'Dados inválidos.', details: error.issues },
      });
    }
    request.log.error(error);
    const { statusCode, message } = error as { statusCode?: number; message?: string };
    const status = statusCode ?? 500;
    return reply.code(status).send({
      error:
        status >= 500
          ? { code: 'internal_error', message: 'Erro interno.' }
          : { code: 'request_error', message: message ?? 'Requisição inválida.' },
    });
  });

  app.get('/api/health', async (): Promise<HealthResponse> => {
    return { status: 'ok', time: new Date().toISOString() };
  });

  if (db && auth) {
    registerAuth(app, auth, appUrl);
    meRoutes(app, db);
    inviteRoutes(app, db);
    spaceScoped(app, db, (scoped) => {
      const ctx = { db, today };
      accountRoutes(scoped, ctx);
      categoryRoutes(scoped, ctx);
      transactionRoutes(scoped, ctx);
    });
  }

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
