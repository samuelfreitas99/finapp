import {
  groupBalances,
  simplifyDebts,
  splitExpense,
  todayIn,
  type SplitParticipant,
} from '@finapp/core';
import {
  addParticipantBodySchema,
  createGroupBodySchema,
  groupBalancesQuerySchema,
  groupExpenseBodySchema,
  groupLinkBodySchema,
  groupSettlementBodySchema,
  joinGroupBodySchema,
  updateGroupBodySchema,
  type GroupBalances,
  type GroupDetail,
  type GroupExpense,
  type GroupExpenseBody,
  type GroupLink,
  type GroupSummary,
} from '@finapp/shared';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { generateInviteCode, normalizeInviteCode } from '../../auth/onboarding';
import type { Db } from '../../db/client';
import {
  splitExpensePayers,
  splitExpenseShares,
  splitExpenses,
  splitGroupLinks,
  splitGroups,
  splitParticipants,
  splitSettlements,
} from '../../db/schema';
import { ApiError, badRequest, notFound } from '../../http/errors';
import { currentUser, requireUser } from '../../plugins/auth';
import { findAccount } from '../accounts/service';
import { findCategory } from '../categories/routes';
import { spaceRole } from '../spaces/access';
import { syncAllLinks, syncGroupLink } from './link';

const groupParams = z.object({ groupId: z.uuid() });
const itemParams = z.object({ groupId: z.uuid(), id: z.uuid() });

type Executor = Pick<Db, 'select' | 'insert' | 'update' | 'delete'>;

/** Grupo em que o usuário é participante (senão 404, sem revelar que existe). */
async function memberOf(db: Executor, userId: string, groupId: string) {
  const [row] = await db
    .select({ group: splitGroups, me: splitParticipants })
    .from(splitParticipants)
    .innerJoin(splitGroups, eq(splitGroups.id, splitParticipants.groupId))
    .where(and(eq(splitParticipants.groupId, groupId), eq(splitParticipants.userId, userId)));
  if (!row) throw new ApiError(404, 'group_not_found', 'Grupo não encontrado.');
  return row;
}

async function participantsOf(db: Executor, groupId: string) {
  return db
    .select()
    .from(splitParticipants)
    .where(eq(splitParticipants.groupId, groupId))
    .orderBy(asc(splitParticipants.createdAt), asc(splitParticipants.id));
}

async function loadExpenses(db: Executor, groupId: string): Promise<GroupExpense[]> {
  const rows = await db
    .select()
    .from(splitExpenses)
    .where(and(eq(splitExpenses.groupId, groupId), isNull(splitExpenses.deletedAt)))
    .orderBy(desc(splitExpenses.date), desc(splitExpenses.id));
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [payers, shares] = await Promise.all([
    db.select().from(splitExpensePayers).where(inArray(splitExpensePayers.expenseId, ids)),
    db.select().from(splitExpenseShares).where(inArray(splitExpenseShares.expenseId, ids)),
  ]);
  return rows.map((r) => ({
    id: r.id,
    description: r.description,
    amount: r.amount,
    date: r.date,
    mode: r.splitMode,
    category: r.category,
    payers: payers
      .filter((p) => p.expenseId === r.id)
      .map((p) => ({ participantId: p.participantId, amount: p.amount })),
    shares: shares
      .filter((s) => s.expenseId === r.id)
      .map((s) => ({ participantId: s.participantId, amount: s.amount, weight: s.weight })),
  }));
}

async function loadSettlements(db: Executor, groupId: string) {
  return db
    .select()
    .from(splitSettlements)
    .where(and(eq(splitSettlements.groupId, groupId), isNull(splitSettlements.deletedAt)))
    .orderBy(desc(splitSettlements.date), desc(splitSettlements.id));
}

/** Saldo de cada participante (pagou − deve, com os acertos) e, se pedido, os pagamentos mínimos. */
async function computeBalances(
  db: Executor,
  groupId: string,
  simplify: boolean,
): Promise<GroupBalances> {
  const [people, expenses, settlements] = await Promise.all([
    participantsOf(db, groupId),
    loadExpenses(db, groupId),
    loadSettlements(db, groupId),
  ]);
  const balances = groupBalances(
    expenses.map((e) => ({
      payers: e.payers.map((p) => ({ id: p.participantId, amount: p.amount })),
      shares: e.shares.map((s) => ({ id: s.participantId, amount: s.amount })),
    })),
    settlements.map((s) => ({
      from: s.fromParticipantId,
      to: s.toParticipantId,
      amount: s.amount,
    })),
  );
  for (const p of people) if (!balances.has(p.id)) balances.set(p.id, 0);
  return {
    balances: people.map((p) => ({
      participantId: p.id,
      name: p.name,
      balance: balances.get(p.id) ?? 0,
    })),
    transfers: simplify
      ? simplifyDebts(balances).map((t) => ({
          fromParticipantId: t.from,
          toParticipantId: t.to,
          amount: t.amount,
        }))
      : [],
  };
}

/** Valida a despesa e devolve as partes calculadas (resto vai para o primeiro pagador). */
function buildShares(body: GroupExpenseBody, memberIds: Set<string>) {
  const paid = body.payers.reduce((a, p) => a + p.amount, 0);
  if (paid !== body.amount) {
    throw badRequest('payers_mismatch', 'O que foi pago deve somar o valor da despesa.');
  }
  for (const id of [
    ...body.payers.map((p) => p.participantId),
    ...body.shares.map((s) => s.participantId),
  ]) {
    if (!memberIds.has(id))
      throw badRequest('invalid_participant', 'Há alguém que não é do grupo.');
  }
  if (new Set(body.payers.map((p) => p.participantId)).size !== body.payers.length) {
    throw badRequest('invalid_payers', 'Cada pessoa aparece uma vez entre quem pagou.');
  }
  const participants: SplitParticipant[] = body.shares.map((s) => ({
    id: s.participantId,
    ...(s.percent !== undefined ? { percent: s.percent } : {}),
    ...(s.amount !== undefined ? { amount: s.amount } : {}),
    ...(s.weight !== undefined ? { weight: s.weight } : {}),
  }));
  try {
    return splitExpense(body.amount, body.mode, participants, body.payers[0]?.participantId);
  } catch {
    throw badRequest(
      'invalid_split',
      body.mode === 'percent'
        ? 'Os percentuais devem somar 100.'
        : body.mode === 'amount'
          ? 'As partes devem somar o valor da despesa.'
          : body.mode === 'shares'
            ? 'Informe as cotas (números inteiros a partir de 1).'
            : 'Divisão inválida.',
    );
  }
}

/** Racha entre amigos: grupos, despesas, saldos, simplificação e acertos. @see RN 11 */
export function rachaRoutes(app: FastifyInstance, db: Db, today: () => string = () => todayIn()) {
  const pre = { preHandler: requireUser };

  app.get('/api/split-groups', pre, async (request) => {
    const user = currentUser(request);
    const mine = await db
      .select({ group: splitGroups, me: splitParticipants.id })
      .from(splitParticipants)
      .innerJoin(splitGroups, eq(splitGroups.id, splitParticipants.groupId))
      .where(eq(splitParticipants.userId, user.id))
      .orderBy(desc(splitGroups.createdAt));
    const items: GroupSummary[] = [];
    for (const { group, me } of mine) {
      const [people, b] = await Promise.all([
        participantsOf(db, group.id),
        computeBalances(db, group.id, false),
      ]);
      items.push({
        id: group.id,
        name: group.name,
        archived: group.archivedAt !== null,
        participantCount: people.length,
        myBalance: b.balances.find((x) => x.participantId === me)?.balance ?? 0,
      });
    }
    return { items };
  });

  app.post('/api/split-groups', pre, async (request, reply) => {
    const user = currentUser(request);
    const body = createGroupBodySchema.parse(request.body ?? {});
    const group = await db.transaction(async (tx) => {
      const [g] = await tx
        .insert(splitGroups)
        .values({ name: body.name, joinCode: generateInviteCode(), createdBy: user.id })
        .returning();
      if (!g) throw new Error('falha ao criar grupo');
      await tx
        .insert(splitParticipants)
        .values({ groupId: g.id, userId: user.id, name: user.name });
      for (const friend of body.friends ?? []) {
        await tx.insert(splitParticipants).values({ groupId: g.id, name: friend });
      }
      return g;
    });
    return reply.code(201).send({ id: group.id, name: group.name });
  });

  app.get('/api/split-groups/:groupId', pre, async (request): Promise<GroupDetail> => {
    const user = currentUser(request);
    const { groupId } = groupParams.parse(request.params);
    const { group } = await memberOf(db, user.id, groupId);
    const [people, expenses, settlements, balances] = await Promise.all([
      participantsOf(db, groupId),
      loadExpenses(db, groupId),
      loadSettlements(db, groupId),
      computeBalances(db, groupId, true),
    ]);
    return {
      id: group.id,
      name: group.name,
      archived: group.archivedAt !== null,
      joinCode: group.joinCode,
      participants: people.map((p) => ({
        id: p.id,
        name: p.name,
        userId: p.userId,
        isMe: p.userId === user.id,
      })),
      expenses,
      settlements: settlements.map((s) => ({
        id: s.id,
        fromParticipantId: s.fromParticipantId,
        toParticipantId: s.toParticipantId,
        amount: s.amount,
        date: s.date,
        method: s.method,
      })),
      balances,
    };
  });

  app.patch('/api/split-groups/:groupId', pre, async (request, reply) => {
    const { groupId } = groupParams.parse(request.params);
    const body = updateGroupBodySchema.parse(request.body ?? {});
    await memberOf(db, currentUser(request).id, groupId);
    const set: Partial<typeof splitGroups.$inferInsert> = {};
    if (body.name !== undefined) set.name = body.name;
    if (body.archived !== undefined) set.archivedAt = body.archived ? new Date() : null;
    if (Object.keys(set).length)
      await db.update(splitGroups).set(set).where(eq(splitGroups.id, groupId));
    return reply.code(204).send();
  });

  app.post('/api/split-groups/:groupId/participants', pre, async (request, reply) => {
    const { groupId } = groupParams.parse(request.params);
    const body = addParticipantBodySchema.parse(request.body ?? {});
    await memberOf(db, currentUser(request).id, groupId);
    const [row] = await db
      .insert(splitParticipants)
      .values({ groupId, name: body.name })
      .returning();
    return reply.code(201).send({ id: row?.id, name: body.name });
  });

  /** Remove alguém que ainda não aparece em nenhuma despesa nem acerto. */
  app.delete('/api/split-groups/:groupId/participants/:id', pre, async (request, reply) => {
    const { groupId, id } = itemParams.parse(request.params);
    await memberOf(db, currentUser(request).id, groupId);
    const [person] = await db
      .select()
      .from(splitParticipants)
      .where(and(eq(splitParticipants.id, id), eq(splitParticipants.groupId, groupId)));
    if (!person) throw notFound('Participante');
    const [usedPayer, usedShare, usedFrom, usedTo] = await Promise.all([
      db.select().from(splitExpensePayers).where(eq(splitExpensePayers.participantId, id)).limit(1),
      db.select().from(splitExpenseShares).where(eq(splitExpenseShares.participantId, id)).limit(1),
      db.select().from(splitSettlements).where(eq(splitSettlements.fromParticipantId, id)).limit(1),
      db.select().from(splitSettlements).where(eq(splitSettlements.toParticipantId, id)).limit(1),
    ]);
    if (usedPayer.length || usedShare.length || usedFrom.length || usedTo.length) {
      throw badRequest(
        'participant_in_use',
        'Essa pessoa já aparece em despesas ou acertos e não pode ser removida.',
      );
    }
    if (person.userId === currentUser(request).id) {
      throw badRequest('cannot_remove_self', 'Você não pode se remover do grupo.');
    }
    await db.delete(splitParticipants).where(eq(splitParticipants.id, id));
    return reply.code(204).send();
  });

  /** Amigo com conta entra pelo código, como novo participante ou assumindo um nome cadastrado. */
  app.post('/api/split-groups/join', pre, async (request, reply) => {
    const user = currentUser(request);
    const body = joinGroupBodySchema.parse(request.body ?? {});
    const [group] = await db
      .select()
      .from(splitGroups)
      .where(eq(splitGroups.joinCode, normalizeInviteCode(body.code)));
    if (!group || group.archivedAt) {
      throw badRequest('invalid_code', 'Código inválido ou grupo arquivado.');
    }
    const people = await participantsOf(db, group.id);
    if (people.some((p) => p.userId === user.id)) return reply.code(200).send({ id: group.id });
    if (body.participantId) {
      const [claimed] = await db
        .update(splitParticipants)
        .set({ userId: user.id })
        .where(
          and(
            eq(splitParticipants.id, body.participantId),
            eq(splitParticipants.groupId, group.id),
            isNull(splitParticipants.userId),
          ),
        )
        .returning({ id: splitParticipants.id });
      if (!claimed) throw badRequest('invalid_participant', 'Esse nome já tem dono ou não existe.');
    } else {
      await db
        .insert(splitParticipants)
        .values({ groupId: group.id, userId: user.id, name: user.name });
    }
    return reply.code(200).send({ id: group.id });
  });

  /** Nomes ainda sem conta no grupo do código (para a pessoa dizer "sou eu"). */
  app.get('/api/split-groups/join/:code', pre, async (request) => {
    const { code } = z.object({ code: z.string().min(4).max(40) }).parse(request.params);
    const [group] = await db
      .select()
      .from(splitGroups)
      .where(eq(splitGroups.joinCode, normalizeInviteCode(code)));
    if (!group || group.archivedAt) {
      throw badRequest('invalid_code', 'Código inválido ou grupo arquivado.');
    }
    const people = await participantsOf(db, group.id);
    return {
      name: group.name,
      unclaimed: people.filter((p) => !p.userId).map((p) => ({ id: p.id, name: p.name })),
    };
  });

  const saveExpense = async (
    groupId: string,
    body: GroupExpenseBody,
    userId: string,
    expenseId?: string,
  ) => {
    const people = await participantsOf(db, groupId);
    const shares = buildShares(body, new Set(people.map((p) => p.id)));
    return db.transaction(async (tx) => {
      let id = expenseId;
      const values = {
        description: body.description,
        amount: body.amount,
        date: body.date,
        splitMode: body.mode,
        category: body.category ?? null,
      };
      if (id) {
        await tx.update(splitExpenses).set(values).where(eq(splitExpenses.id, id));
        await tx.delete(splitExpensePayers).where(eq(splitExpensePayers.expenseId, id));
        await tx.delete(splitExpenseShares).where(eq(splitExpenseShares.expenseId, id));
      } else {
        const [row] = await tx
          .insert(splitExpenses)
          .values({ groupId, createdBy: userId, ...values })
          .returning({ id: splitExpenses.id });
        id = row?.id;
      }
      if (!id) throw new Error('falha ao salvar despesa');
      await tx.insert(splitExpensePayers).values(
        body.payers.map((p) => ({
          expenseId: id,
          participantId: p.participantId,
          amount: p.amount,
        })),
      );
      await tx.insert(splitExpenseShares).values(
        shares.map((s) => ({
          expenseId: id,
          participantId: s.id,
          amount: s.amount,
          weight: body.shares.find((x) => x.participantId === s.id)?.weight ?? null,
        })),
      );
      return id;
    });
  };

  const requireOpen = (archivedAt: Date | null) => {
    if (archivedAt)
      throw badRequest('group_archived', 'O grupo está arquivado. Reabra para editar.');
  };

  app.post('/api/split-groups/:groupId/expenses', pre, async (request, reply) => {
    const user = currentUser(request);
    const { groupId } = groupParams.parse(request.params);
    const body = groupExpenseBodySchema.parse(request.body ?? {});
    const { group } = await memberOf(db, user.id, groupId);
    requireOpen(group.archivedAt);
    const id = await saveExpense(groupId, body, user.id);
    await syncAllLinks(db, groupId);
    return reply.code(201).send({ id });
  });

  app.put('/api/split-groups/:groupId/expenses/:id', pre, async (request, reply) => {
    const user = currentUser(request);
    const { groupId, id } = itemParams.parse(request.params);
    const body = groupExpenseBodySchema.parse(request.body ?? {});
    const { group } = await memberOf(db, user.id, groupId);
    requireOpen(group.archivedAt);
    const [exists] = await db
      .select({ id: splitExpenses.id })
      .from(splitExpenses)
      .where(
        and(
          eq(splitExpenses.id, id),
          eq(splitExpenses.groupId, groupId),
          isNull(splitExpenses.deletedAt),
        ),
      );
    if (!exists) throw notFound('Despesa');
    await saveExpense(groupId, body, user.id, id);
    await syncAllLinks(db, groupId);
    return reply.code(204).send();
  });

  app.delete('/api/split-groups/:groupId/expenses/:id', pre, async (request, reply) => {
    const { groupId, id } = itemParams.parse(request.params);
    const { group } = await memberOf(db, currentUser(request).id, groupId);
    requireOpen(group.archivedAt);
    const [row] = await db
      .update(splitExpenses)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(splitExpenses.id, id),
          eq(splitExpenses.groupId, groupId),
          isNull(splitExpenses.deletedAt),
        ),
      )
      .returning({ id: splitExpenses.id });
    if (!row) throw notFound('Despesa');
    await syncAllLinks(db, groupId);
    return reply.code(204).send();
  });

  app.get('/api/split-groups/:groupId/balances', pre, async (request): Promise<GroupBalances> => {
    const { groupId } = groupParams.parse(request.params);
    const query = groupBalancesQuerySchema.parse(request.query);
    await memberOf(db, currentUser(request).id, groupId);
    return computeBalances(db, groupId, query.simplify);
  });

  app.post('/api/split-groups/:groupId/settlements', pre, async (request, reply) => {
    const user = currentUser(request);
    const { groupId } = groupParams.parse(request.params);
    const body = groupSettlementBodySchema.parse(request.body ?? {});
    const { group } = await memberOf(db, user.id, groupId);
    requireOpen(group.archivedAt);
    const ids = new Set((await participantsOf(db, groupId)).map((p) => p.id));
    if (
      !ids.has(body.fromParticipantId) ||
      !ids.has(body.toParticipantId) ||
      body.fromParticipantId === body.toParticipantId
    ) {
      throw badRequest('invalid_settlement', 'Escolha duas pessoas diferentes do grupo.');
    }
    const [row] = await db
      .insert(splitSettlements)
      .values({
        groupId,
        fromParticipantId: body.fromParticipantId,
        toParticipantId: body.toParticipantId,
        amount: body.amount,
        date: body.date ?? today(),
        method: body.method ?? null,
        createdBy: user.id,
      })
      .returning({ id: splitSettlements.id });
    return reply.code(201).send({ id: row?.id });
  });

  app.delete('/api/split-groups/:groupId/settlements/:id', pre, async (request, reply) => {
    const { groupId, id } = itemParams.parse(request.params);
    await memberOf(db, currentUser(request).id, groupId);
    const [row] = await db
      .update(splitSettlements)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(splitSettlements.id, id),
          eq(splitSettlements.groupId, groupId),
          isNull(splitSettlements.deletedAt),
        ),
      )
      .returning({ id: splitSettlements.id });
    if (!row) throw notFound('Acerto');
    return reply.code(204).send();
  });

  app.get('/api/split-groups/:groupId/link', pre, async (request): Promise<GroupLink> => {
    const user = currentUser(request);
    const { groupId } = groupParams.parse(request.params);
    await memberOf(db, user.id, groupId);
    const [link] = await db
      .select()
      .from(splitGroupLinks)
      .where(and(eq(splitGroupLinks.groupId, groupId), eq(splitGroupLinks.userId, user.id)));
    return {
      linked: Boolean(link),
      spaceId: link?.spaceId ?? null,
      accountId: link?.accountId ?? null,
      categoryId: link?.categoryId ?? null,
    };
  });

  /** Liga (ou troca) o espaço/conta onde a sua parte vira lançamento e já sincroniza. */
  app.put('/api/split-groups/:groupId/link', pre, async (request) => {
    const user = currentUser(request);
    const { groupId } = groupParams.parse(request.params);
    const body = groupLinkBodySchema.parse(request.body ?? {});
    await memberOf(db, user.id, groupId);
    if (!(await spaceRole(db, user.id, body.spaceId))) {
      throw new ApiError(404, 'space_not_found', 'Espaço não encontrado.');
    }
    const account = await findAccount(db, body.spaceId, body.accountId);
    if (account.archivedAt) throw badRequest('account_archived', 'A conta está arquivada.');
    if (body.categoryId) {
      const category = await findCategory(db, body.spaceId, body.categoryId);
      if (category.isSystem || category.archivedAt || category.kind !== 'expense') {
        throw badRequest('invalid_category', 'Use uma categoria de despesa ativa.');
      }
    }
    const [link] = await db
      .insert(splitGroupLinks)
      .values({
        groupId,
        userId: user.id,
        spaceId: body.spaceId,
        accountId: body.accountId,
        categoryId: body.categoryId ?? null,
      })
      .onConflictDoUpdate({
        target: [splitGroupLinks.groupId, splitGroupLinks.userId],
        set: {
          spaceId: body.spaceId,
          accountId: body.accountId,
          categoryId: body.categoryId ?? null,
        },
      })
      .returning();
    if (!link) throw new Error('falha ao ligar o grupo');
    return syncGroupLink(db, link);
  });

  app.post('/api/split-groups/:groupId/link/sync', pre, async (request) => {
    const user = currentUser(request);
    const { groupId } = groupParams.parse(request.params);
    await memberOf(db, user.id, groupId);
    const [link] = await db
      .select()
      .from(splitGroupLinks)
      .where(and(eq(splitGroupLinks.groupId, groupId), eq(splitGroupLinks.userId, user.id)));
    if (!link) throw badRequest('not_linked', 'Ligue o grupo ao seu espaço primeiro.');
    return syncGroupLink(db, link);
  });

  /** Desliga: os lançamentos já criados ficam como estão; novas despesas deixam de entrar. */
  app.delete('/api/split-groups/:groupId/link', pre, async (request, reply) => {
    const user = currentUser(request);
    const { groupId } = groupParams.parse(request.params);
    await memberOf(db, user.id, groupId);
    await db
      .delete(splitGroupLinks)
      .where(and(eq(splitGroupLinks.groupId, groupId), eq(splitGroupLinks.userId, user.id)));
    return reply.code(204).send();
  });
}
