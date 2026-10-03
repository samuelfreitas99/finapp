import { auditQuerySchema, type AuditItem } from '@finapp/shared';
import { and, desc, eq, lt } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { auditLog, users } from '../../db/schema';
import { spaceIdOf, type SpaceContext } from '../spaces/scope';

/** Histórico de alterações do espaço (mais recentes primeiro). */
export function auditRoutes(app: FastifyInstance, { db }: SpaceContext) {
  app.get('/audit-log', async (request) => {
    const spaceId = spaceIdOf(request);
    const query = auditQuerySchema.parse(request.query);
    const rows = await db
      .select({
        id: auditLog.id,
        at: auditLog.at,
        userName: users.name,
        entityType: auditLog.entityType,
        entityId: auditLog.entityId,
        action: auditLog.action,
        after: auditLog.after,
      })
      .from(auditLog)
      .leftJoin(users, eq(users.id, auditLog.userId))
      .where(
        and(
          eq(auditLog.spaceId, spaceId),
          query.cursor ? lt(auditLog.id, query.cursor) : undefined,
          query.entity ? eq(auditLog.entityType, query.entity) : undefined,
        ),
      )
      // uuid v7: a ordem do id é a ordem do tempo.
      .orderBy(desc(auditLog.id))
      .limit(query.limit + 1);
    const page = rows.slice(0, query.limit);
    const items: AuditItem[] = page.map((r) => ({
      ...r,
      at: r.at.toISOString(),
      after: (r.after as Record<string, unknown> | null) ?? null,
    }));
    return { items, nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null };
  });
}
