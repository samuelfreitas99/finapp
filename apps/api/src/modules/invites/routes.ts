import { createInviteBodySchema, type Invite } from '@finapp/shared';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { generateInviteCode } from '../../auth/onboarding';
import type { Db } from '../../db/client';
import { invites, spaces } from '../../db/schema';
import { notFound } from '../../http/errors';
import { currentUser, requireUser } from '../../plugins/auth';
import { spaceRole } from '../spaces/access';

type InviteRow = typeof invites.$inferSelect;

function toInvite(row: InviteRow): Invite {
  return {
    id: row.id,
    code: row.code,
    spaceId: row.spaceId,
    email: row.email,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    usedAt: row.usedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export function inviteRoutes(app: FastifyInstance, db: Db) {
  app.get('/api/invites', { preHandler: requireUser }, async (request) => {
    const user = currentUser(request);
    const rows = await db
      .select()
      .from(invites)
      .where(eq(invites.createdBy, user.id))
      .orderBy(desc(invites.createdAt));
    return { items: rows.map(toInvite) };
  });

  app.post('/api/invites', { preHandler: requireUser }, async (request, reply) => {
    const user = currentUser(request);
    const body = createInviteBodySchema.parse(request.body ?? {});
    if (body.spaceId) {
      const role = await spaceRole(db, user.id, body.spaceId);
      const [space] = await db
        .select({ type: spaces.type })
        .from(spaces)
        .where(eq(spaces.id, body.spaceId));
      if (space?.type !== 'shared') {
        return reply.code(400).send({
          error: {
            code: 'personal_space',
            message: 'O espaço pessoal não pode ser compartilhado.',
          },
        });
      }
      if (role !== 'owner') {
        return reply
          .code(403)
          .send({ error: { code: 'forbidden', message: 'Só o dono do espaço pode convidar.' } });
      }
    }
    const days = body.expiresInDays ?? 7;
    const [row] = await db
      .insert(invites)
      .values({
        code: generateInviteCode(),
        createdBy: user.id,
        spaceId: body.spaceId ?? null,
        email: body.email?.toLowerCase() ?? null,
        expiresAt: new Date(Date.now() + days * 86_400_000),
      })
      .returning();
    if (!row) throw new Error('falha ao criar convite');
    return reply.code(201).send(toInvite(row));
  });

  /** Cancela um convite que você criou e que ainda não foi usado. */
  app.delete('/api/invites/:id', { preHandler: requireUser }, async (request, reply) => {
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const [row] = await db
      .delete(invites)
      .where(
        and(
          eq(invites.id, id),
          eq(invites.createdBy, currentUser(request).id),
          isNull(invites.usedAt),
        ),
      )
      .returning({ id: invites.id });
    if (!row) throw notFound('Convite');
    return reply.code(204).send();
  });
}
