import { yearMonthOf, type ISODate } from '@finapp/core';
import {
  acceptInviteBodySchema,
  activeSpaceBodySchema,
  consolidatedQuerySchema,
  createSpaceBodySchema,
  deleteSpaceBodySchema,
  spaceItemParamsSchema,
  spaceParamsSchema,
  transferSpaceBodySchema,
  updateSpaceBodySchema,
  type Consolidated,
  type SpaceMember,
} from '@finapp/shared';
import { and, asc, eq, gt, isNull, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { normalizeInviteCode } from '../../auth/onboarding';
import type { Db } from '../../db/client';
import { invites, spaceMembers, spaces, userSettings, users } from '../../db/schema';
import { seedSpaceCategories } from '../../db/seed';
import { ApiError, badRequest, notFound } from '../../http/errors';
import { currentUser, requireUser } from '../../plugins/auth';
import { buildDashboard } from '../dashboard/routes';
import { spaceRole, userSpaces } from './access';

/** Espaço (não apagado) e papel do usuário nele; 404 se não for membro. */
async function memberSpace(db: Db, userId: string, spaceId: string) {
  const role = await spaceRole(db, userId, spaceId);
  if (!role) throw new ApiError(404, 'space_not_found', 'Espaço não encontrado.');
  const [space] = await db.select().from(spaces).where(eq(spaces.id, spaceId));
  if (!space) throw new ApiError(404, 'space_not_found', 'Espaço não encontrado.');
  return { space, role };
}

const ownerOnly = (role: string, what: string) => {
  if (role !== 'owner') throw new ApiError(403, 'forbidden', `Só o dono do espaço pode ${what}.`);
};

/** Espaços compartilhados: criar, renomear, membros, entrar por convite e espaço ativo. */
export function spaceRoutes(app: FastifyInstance, db: Db, today: () => ISODate) {
  app.post('/api/spaces', { preHandler: requireUser }, async (request, reply) => {
    const user = currentUser(request);
    const body = createSpaceBodySchema.parse(request.body ?? {});
    const space = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(spaces)
        .values({ name: body.name, type: 'shared', createdBy: user.id })
        .returning();
      if (!row) throw new Error('falha ao criar espaço');
      await tx.insert(spaceMembers).values({ spaceId: row.id, userId: user.id, role: 'owner' });
      await seedSpaceCategories(tx, row.id, user.id);
      return row;
    });
    return reply
      .code(201)
      .send({ id: space.id, name: space.name, type: space.type, role: 'owner' });
  });

  app.patch('/api/spaces/:spaceId', { preHandler: requireUser }, async (request) => {
    const { spaceId } = spaceParamsSchema.parse(request.params);
    const body = updateSpaceBodySchema.parse(request.body ?? {});
    const { space, role } = await memberSpace(db, currentUser(request).id, spaceId);
    ownerOnly(role, 'renomear');
    if (space.type === 'personal')
      throw badRequest('personal_space', 'O espaço pessoal tem nome fixo.');
    await db.update(spaces).set({ name: body.name }).where(eq(spaces.id, spaceId));
    return { id: space.id, name: body.name, type: space.type, role };
  });

  app.get('/api/spaces/:spaceId/members', { preHandler: requireUser }, async (request) => {
    const { spaceId } = spaceParamsSchema.parse(request.params);
    await memberSpace(db, currentUser(request).id, spaceId);
    const rows = await db
      .select({
        userId: spaceMembers.userId,
        name: users.name,
        email: users.email,
        role: spaceMembers.role,
        joinedAt: spaceMembers.joinedAt,
      })
      .from(spaceMembers)
      .innerJoin(users, eq(users.id, spaceMembers.userId))
      .where(eq(spaceMembers.spaceId, spaceId))
      .orderBy(asc(spaceMembers.joinedAt));
    const items: SpaceMember[] = rows.map((r) => ({ ...r, joinedAt: r.joinedAt.toISOString() }));
    return { items };
  });

  /** O dono remove um membro; qualquer membro pode sair (o dono não, enquanto houver outros). */
  app.delete(
    '/api/spaces/:spaceId/members/:id',
    { preHandler: requireUser },
    async (request, reply) => {
      const { spaceId, id: targetId } = spaceItemParamsSchema.parse(request.params);
      const user = currentUser(request);
      const { space, role } = await memberSpace(db, user.id, spaceId);
      if (space.type === 'personal')
        throw badRequest('personal_space', 'O espaço pessoal não tem outros membros.');
      const leaving = targetId === user.id;
      if (!leaving) ownerOnly(role, 'remover membros');
      const [target] = await db
        .select({ role: spaceMembers.role })
        .from(spaceMembers)
        .where(and(eq(spaceMembers.spaceId, spaceId), eq(spaceMembers.userId, targetId)));
      if (!target) throw notFound('Membro');
      if (target.role === 'owner') {
        throw badRequest(
          'owner_cannot_leave',
          'O dono não pode sair nem ser removido. Passe a posse para outro membro antes de sair.',
        );
      }
      await db.transaction(async (tx) => {
        await tx
          .delete(spaceMembers)
          .where(and(eq(spaceMembers.spaceId, spaceId), eq(spaceMembers.userId, targetId)));
        // Quem tinha este espaço como ativo volta para o pessoal.
        const personal = (await userSpaces(tx as unknown as Db, targetId)).find(
          (s) => s.type === 'personal',
        );
        await tx
          .update(userSettings)
          .set({ activeSpaceId: personal?.id ?? null })
          .where(and(eq(userSettings.userId, targetId), eq(userSettings.activeSpaceId, spaceId)));
      });
      return reply.code(204).send();
    },
  );

  /**
   * O dono passa a posse para outro membro (que vira dono); quem passou continua como membro
   * e pode sair depois.
   */
  app.post('/api/spaces/:spaceId/transfer', { preHandler: requireUser }, async (request) => {
    const { spaceId } = spaceParamsSchema.parse(request.params);
    const body = transferSpaceBodySchema.parse(request.body ?? {});
    const user = currentUser(request);
    const { space, role } = await memberSpace(db, user.id, spaceId);
    ownerOnly(role, 'passar a posse');
    if (space.type === 'personal')
      throw badRequest('personal_space', 'O espaço pessoal não pode mudar de dono.');
    if (body.userId === user.id) throw badRequest('already_owner', 'Você já é o dono.');
    const [target] = await db
      .select({ role: spaceMembers.role })
      .from(spaceMembers)
      .where(and(eq(spaceMembers.spaceId, spaceId), eq(spaceMembers.userId, body.userId)));
    if (!target) throw notFound('Membro');
    await db.transaction(async (tx) => {
      await tx
        .update(spaceMembers)
        .set({ role: 'owner' })
        .where(and(eq(spaceMembers.spaceId, spaceId), eq(spaceMembers.userId, body.userId)));
      await tx
        .update(spaceMembers)
        .set({ role: 'member' })
        .where(and(eq(spaceMembers.spaceId, spaceId), eq(spaceMembers.userId, user.id)));
    });
    return { id: space.id, name: space.name, type: space.type, role: 'member' };
  });

  /**
   * O dono exclui um espaço compartilhado (confirmando o nome). Exclusão lógica: o espaço
   * some para todos, os dados ficam no banco (`deleted_at`), convites não usados caem e quem
   * estava nele volta para o espaço pessoal.
   */
  app.delete('/api/spaces/:spaceId', { preHandler: requireUser }, async (request, reply) => {
    const { spaceId } = spaceParamsSchema.parse(request.params);
    const body = deleteSpaceBodySchema.parse(request.body ?? {});
    const user = currentUser(request);
    const { space, role } = await memberSpace(db, user.id, spaceId);
    ownerOnly(role, 'excluir o espaço');
    if (space.type === 'personal')
      throw badRequest('personal_space', 'O espaço pessoal não pode ser excluído.');
    if (body.confirmName.toLowerCase() !== space.name.trim().toLowerCase()) {
      throw badRequest('confirm_name', 'Digite o nome do espaço exatamente como aparece.');
    }
    const members = await db
      .select({ userId: spaceMembers.userId })
      .from(spaceMembers)
      .where(eq(spaceMembers.spaceId, spaceId));
    await db.transaction(async (tx) => {
      await tx.update(spaces).set({ deletedAt: new Date() }).where(eq(spaces.id, spaceId));
      await tx.delete(invites).where(and(eq(invites.spaceId, spaceId), isNull(invites.usedAt)));
      for (const m of members) {
        const personal = (await userSpaces(tx as unknown as Db, m.userId)).find(
          (s) => s.type === 'personal',
        );
        await tx
          .update(userSettings)
          .set({ activeSpaceId: personal?.id ?? null })
          .where(and(eq(userSettings.userId, m.userId), eq(userSettings.activeSpaceId, spaceId)));
      }
    });
    return reply.code(204).send();
  });

  /** Usuário que já tem conta entra num espaço compartilhado com o código de convite. */
  app.post('/api/invites/accept', { preHandler: requireUser }, async (request) => {
    const user = currentUser(request);
    const body = acceptInviteBodySchema.parse(request.body ?? {});
    const [invite] = await db
      .update(invites)
      .set({ usedAt: new Date(), usedBy: user.id })
      .where(
        and(
          eq(invites.code, normalizeInviteCode(body.code)),
          isNull(invites.usedAt),
          sql`${invites.spaceId} is not null`,
          or(isNull(invites.expiresAt), gt(invites.expiresAt, sql`now()`)),
          or(isNull(invites.email), eq(sql`lower(${invites.email})`, user.email.toLowerCase())),
        ),
      )
      .returning();
    if (!invite?.spaceId) {
      throw badRequest(
        'invite_invalid',
        'Convite inválido, expirado, já usado ou de outro e-mail.',
      );
    }
    await db
      .insert(spaceMembers)
      .values({ spaceId: invite.spaceId, userId: user.id, role: 'member' })
      .onConflictDoNothing();
    const [space] = await db.select().from(spaces).where(eq(spaces.id, invite.spaceId));
    return {
      id: invite.spaceId,
      name: space?.name ?? 'Espaço',
      type: space?.type ?? 'shared',
      role: 'member',
    };
  });

  app.put('/api/me/active-space', { preHandler: requireUser }, async (request, reply) => {
    const user = currentUser(request);
    const body = activeSpaceBodySchema.parse(request.body ?? {});
    await memberSpace(db, user.id, body.spaceId);
    await db
      .insert(userSettings)
      .values({ userId: user.id, activeSpaceId: body.spaceId })
      .onConflictDoUpdate({ target: userSettings.userId, set: { activeSpaceId: body.spaceId } });
    return reply.code(204).send();
  });

  /** Todos os espaços do usuário (pessoal + compartilhados) somados, mais o detalhe de cada um. */
  app.get(
    '/api/consolidated',
    { preHandler: requireUser },
    async (request): Promise<Consolidated> => {
      const user = currentUser(request);
      const query = consolidatedQuerySchema.parse(request.query);
      const t = today();
      const month = query.month ?? yearMonthOf(t);
      const mine = await userSpaces(db, user.id);
      const rows = await Promise.all(
        mine.map(async (s) => {
          const d = await buildDashboard(db, s.id, month, t);
          return {
            id: s.id,
            name: s.name,
            type: s.type,
            balance: d.balance,
            forecastBalance: d.forecastBalance,
            income: d.income.settled,
            expense: d.expense.settled,
          };
        }),
      );
      const sum = (pick: (r: (typeof rows)[number]) => number) =>
        rows.reduce((a, r) => a + pick(r), 0);
      return {
        month,
        spaces: rows,
        totals: {
          balance: sum((r) => r.balance),
          forecastBalance: sum((r) => r.forecastBalance),
          income: sum((r) => r.income),
          expense: sum((r) => r.expense),
        },
      };
    },
  );
}
