import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Auth } from '../auth/auth';

export interface SessionUser {
  id: string;
  name: string;
  email: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser | null;
  }
}

function toHeaders(request: FastifyRequest): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    headers.set(key, Array.isArray(value) ? value.join(', ') : String(value));
  }
  return headers;
}

/**
 * Monta o Better Auth em `/api/auth/*` e preenche `request.user` a partir do cookie
 * de sessão em toda requisição da API.
 */
export function registerAuth(app: FastifyInstance, auth: Auth, appUrl: string) {
  app.decorateRequest('user', null);

  app.route({
    method: ['GET', 'POST'],
    url: '/api/auth/*',
    handler: async (request, reply) => {
      const url = new URL(request.url, appUrl);
      const hasBody =
        request.method !== 'GET' && request.body !== undefined && request.body !== null;
      const response = await auth.handler(
        new Request(url, {
          method: request.method,
          headers: toHeaders(request),
          ...(hasBody ? { body: JSON.stringify(request.body) } : {}),
        }),
      );
      reply.status(response.status);
      response.headers.forEach((value, key) => {
        if (key.toLowerCase() !== 'set-cookie') reply.header(key, value);
      });
      const cookies = response.headers.getSetCookie();
      if (cookies.length) reply.header('set-cookie', cookies);
      return reply.send(response.body ? await response.text() : null);
    },
  });

  app.addHook('preHandler', async (request) => {
    if (!request.url.startsWith('/api/') || request.url.startsWith('/api/auth/')) return;
    const session = await auth.api.getSession({ headers: toHeaders(request) });
    request.user = session
      ? { id: session.user.id, name: session.user.name, email: session.user.email }
      : null;
  });
}

/** preHandler: exige usuário autenticado. */
export async function requireUser(request: FastifyRequest, reply: FastifyReply) {
  if (!request.user) {
    return reply
      .code(401)
      .send({ error: { code: 'unauthorized', message: 'Faça login para continuar.' } });
  }
}

/** Usuário autenticado (use só depois de `requireUser`). */
export function currentUser(request: FastifyRequest): SessionUser {
  if (!request.user) throw new Error('requireUser não foi aplicado');
  return request.user;
}
