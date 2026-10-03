import type { ISODate } from '@finapp/core';
import { spaceParamsSchema } from '@finapp/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Db } from '../../db/client';
import { ApiError } from '../../http/errors';
import { currentUser, requireUser } from '../../plugins/auth';
import { auditLog } from '../../db/schema';
import { auditEntryFor } from './audit';
import { spaceRole } from './access';

/** Dependências das rotas de um espaço. */
export interface SpaceContext {
  db: Db;
  today: () => ISODate;
}

/**
 * Registra rotas em `/api/spaces/:spaceId/...` exigindo login e que o usuário seja
 * membro do espaço (senão 404, para não revelar que o espaço existe).
 */
export function spaceScoped(
  app: FastifyInstance,
  db: Db,
  register: (scoped: FastifyInstance) => void,
) {
  app.register(
    async (scoped) => {
      scoped.addHook('preHandler', requireUser);
      scoped.addHook('preHandler', async (request) => {
        const { spaceId } = spaceParamsSchema.parse(request.params);
        const role = await spaceRole(db, currentUser(request).id, spaceId);
        if (!role) throw new ApiError(404, 'space_not_found', 'Espaço não encontrado.');
      });
      // Histórico de alterações: uma linha por escrita bem-sucedida. Falha aqui não derruba
      // a resposta (já enviada), só vai para o log.
      scoped.addHook('onResponse', async (request, reply) => {
        const entry = auditEntryFor(request, reply.statusCode);
        if (!entry) return;
        try {
          await db.insert(auditLog).values({
            spaceId: spaceParamsSchema.parse(request.params).spaceId,
            userId: currentUser(request).id,
            ...entry,
          });
        } catch (err) {
          request.log.error({ err }, 'audit_log');
        }
      });
      register(scoped);
    },
    { prefix: '/api/spaces/:spaceId' },
  );
}

/** `spaceId` da rota (já verificado pelo hook de `spaceScoped`). */
export function spaceIdOf(request: FastifyRequest): string {
  return spaceParamsSchema.parse(request.params).spaceId;
}
