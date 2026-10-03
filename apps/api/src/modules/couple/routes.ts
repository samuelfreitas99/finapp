import {
  groupBalances,
  simplifyDebts,
  splitExpense,
  type GroupExpense,
  type SplitParticipant,
} from '@finapp/core';
import {
  coupleSplitBodySchema,
  settlementBodySchema,
  spaceItemParamsSchema,
  splitSettingsBodySchema,
  type CoupleBalance,
  type CoupleSplit,
  type SplitSettings,
} from '@finapp/shared';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../../db/client';
import {
  spaceMembers,
  spaceSettlements,
  spaces,
  transactionSplits,
  transactions,
  users,
} from '../../db/schema';
import { ApiError, badRequest, notFound } from '../../http/errors';
import { currentUser } from '../../plugins/auth';
import { spaceRole } from '../spaces/access';
import { spaceIdOf, type SpaceContext } from '../spaces/scope';

/** Só o espaço compartilhado divide despesas entre membros. */
async function sharedMembers(db: Db, spaceId: string) {
  const [space] = await db.select().from(spaces).where(eq(spaces.id, spaceId));
  if (space?.type !== 'shared') {
    throw badRequest('not_shared_space', 'A divisão entre membros é só do espaço compartilhado.');
  }
  const members = await db
    .select({
      userId: spaceMembers.userId,
      name: users.name,
      splitPercent: spaceMembers.splitPercent,
    })
    .from(spaceMembers)
    .innerJoin(users, eq(users.id, spaceMembers.userId))
    .where(eq(spaceMembers.spaceId, spaceId))
    .orderBy(asc(spaceMembers.joinedAt), asc(spaceMembers.userId));
  return { space, members };
}

/** Divisão entre os membros do espaço compartilhado (casal/família). @see RN 10 */
export function coupleRoutes(app: FastifyInstance, { db, today }: SpaceContext) {
  const findExpense = async (spaceId: string, id: string) => {
    const [row] = await db
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.id, id),
          eq(transactions.spaceId, spaceId),
          isNull(transactions.deletedAt),
        ),
      );
    if (!row) throw notFound('Lançamento');
    if (row.type !== 'expense') throw badRequest('not_expense', 'Só despesas podem ser divididas.');
    return row;
  };

  app.get('/transactions/:id/split', async (request): Promise<CoupleSplit> => {
    const { spaceId, id } = spaceItemParamsSchema.parse(request.params);
    await findExpense(spaceId, id);
    const rows = await db
      .select()
      .from(transactionSplits)
      .where(eq(transactionSplits.transactionId, id));
    return {
      mode: rows.length ? 'amount' : 'none',
      paidByUserId: rows[0]?.paidByUserId ?? null,
      shares: rows.map((r) => ({ userId: r.userId, amount: r.amount })),
    };
  });

  /** Define (ou remove) a divisão da despesa entre os membros. */
  app.put('/transactions/:id/split', async (request, reply) => {
    const { spaceId, id } = spaceItemParamsSchema.parse(request.params);
    const body = coupleSplitBodySchema.parse(request.body ?? {});
    const tx = await findExpense(spaceId, id);
    const { members } = await sharedMembers(db, spaceId);

    if (body.mode === 'none') {
      await db.delete(transactionSplits).where(eq(transactionSplits.transactionId, id));
      return reply.code(204).send();
    }
    const payer = body.paidByUserId;
    if (!payer || !members.some((m) => m.userId === payer)) {
      throw badRequest('invalid_payer', 'Escolha quem pagou entre os membros do espaço.');
    }
    const parts = new Map((body.parts ?? []).map((p) => [p.userId, p]));
    for (const userId of parts.keys()) {
      if (!members.some((m) => m.userId === userId)) {
        throw badRequest('invalid_member', 'A divisão tem alguém que não é membro do espaço.');
      }
    }
    const participants: SplitParticipant[] = members.map((m) => {
      const part = parts.get(m.userId);
      return body.mode === 'percent'
        ? { id: m.userId, percent: part?.percent ?? 0 }
        : body.mode === 'amount'
          ? { id: m.userId, amount: part?.amount ?? 0 }
          : { id: m.userId };
    });
    let shares;
    try {
      shares = splitExpense(tx.amount, body.mode, participants, payer);
    } catch (err) {
      throw badRequest(
        'invalid_split',
        body.mode === 'percent'
          ? 'Os percentuais devem somar 100.'
          : body.mode === 'amount'
            ? 'As partes devem somar o valor da despesa.'
            : err instanceof Error
              ? err.message
              : 'Divisão inválida.',
      );
    }
    await db.transaction(async (trx) => {
      await trx.delete(transactionSplits).where(eq(transactionSplits.transactionId, id));
      await trx.insert(transactionSplits).values(
        shares.map((s) => ({
          spaceId,
          transactionId: id,
          userId: s.id,
          amount: s.amount,
          paidByUserId: payer,
        })),
      );
    });
    return reply.code(204).send();
  });

  app.get('/split-settings', async (request): Promise<SplitSettings> => {
    const spaceId = spaceIdOf(request);
    const { space, members } = await sharedMembers(db, spaceId);
    const saved = (space.defaultSplit as { mode?: SplitSettings['mode'] } | null) ?? null;
    return {
      mode: saved?.mode ?? 'equal',
      percents: Object.fromEntries(members.map((m) => [m.userId, m.splitPercent ?? 0])),
    };
  });

  /** Padrão do espaço (só o dono): sugestão ao dividir uma despesa. */
  app.put('/split-settings', async (request): Promise<SplitSettings> => {
    const spaceId = spaceIdOf(request);
    const body = splitSettingsBodySchema.parse(request.body ?? {});
    if ((await spaceRole(db, currentUser(request).id, spaceId)) !== 'owner') {
      throw new ApiError(403, 'forbidden', 'Só o dono do espaço pode mudar o padrão de divisão.');
    }
    const { members } = await sharedMembers(db, spaceId);
    let percents: Record<string, number> = {};
    if (body.mode === 'percent') {
      percents = Object.fromEntries(members.map((m) => [m.userId, body.percents?.[m.userId] ?? 0]));
      const total = Object.values(percents).reduce((a, b) => a + Math.round(b * 100), 0);
      if (total !== 10000) throw badRequest('invalid_split', 'Os percentuais devem somar 100.');
    }
    await db.transaction(async (trx) => {
      await trx
        .update(spaces)
        .set({ defaultSplit: { mode: body.mode } })
        .where(eq(spaces.id, spaceId));
      if (body.mode === 'percent') {
        for (const [userId, pct] of Object.entries(percents)) {
          await trx
            .update(spaceMembers)
            .set({ splitPercent: pct })
            .where(and(eq(spaceMembers.spaceId, spaceId), eq(spaceMembers.userId, userId)));
        }
      }
    });
    return { mode: body.mode, percents };
  });

  /** Saldo de cada membro, o que falta pagar para zerar e os acertos já feitos. */
  app.get('/couple/balance', async (request): Promise<CoupleBalance> => {
    const spaceId = spaceIdOf(request);
    const { members } = await sharedMembers(db, spaceId);
    const rows = await db
      .select({
        transactionId: transactionSplits.transactionId,
        userId: transactionSplits.userId,
        amount: transactionSplits.amount,
        paidBy: transactionSplits.paidByUserId,
        total: transactions.amount,
      })
      .from(transactionSplits)
      .innerJoin(transactions, eq(transactions.id, transactionSplits.transactionId))
      .where(
        and(
          eq(transactionSplits.spaceId, spaceId),
          isNull(transactions.deletedAt),
          // Só conta o que já foi pago: despesa prevista ainda não gerou dívida.
          eq(transactions.status, 'settled'),
        ),
      );
    const byTx = new Map<string, GroupExpense & { total: number }>();
    for (const r of rows) {
      const cur = byTx.get(r.transactionId) ?? { payers: [], shares: [], total: r.total };
      (cur.shares as { id: string; amount: number }[]).push({ id: r.userId, amount: r.amount });
      byTx.set(r.transactionId, cur);
    }
    let staleCount = 0;
    const expenses: GroupExpense[] = [];
    for (const [txId, e] of byTx) {
      const owed = e.shares.reduce((a, s) => a + s.amount, 0);
      if (owed !== e.total) staleCount++;
      const payer = rows.find((r) => r.transactionId === txId)?.paidBy ?? '';
      // O pagador adiantou o que foi dividido (as partes), mesmo se o valor mudou depois.
      expenses.push({ payers: [{ id: payer, amount: owed }], shares: e.shares });
    }
    const settlementRows = await db
      .select()
      .from(spaceSettlements)
      .where(and(eq(spaceSettlements.spaceId, spaceId), isNull(spaceSettlements.deletedAt)))
      .orderBy(desc(spaceSettlements.date), desc(spaceSettlements.id));
    const balances = groupBalances(
      expenses,
      settlementRows.map((s) => ({ from: s.fromUserId, to: s.toUserId, amount: s.amount })),
    );
    for (const m of members) if (!balances.has(m.userId)) balances.set(m.userId, 0);
    return {
      members: members.map((m) => ({
        userId: m.userId,
        name: m.name,
        balance: balances.get(m.userId) ?? 0,
      })),
      transfers: simplifyDebts(balances).map((t) => ({
        fromUserId: t.from,
        toUserId: t.to,
        amount: t.amount,
      })),
      settlements: settlementRows.map((s) => ({
        id: s.id,
        fromUserId: s.fromUserId,
        toUserId: s.toUserId,
        amount: s.amount,
        date: s.date,
        notes: s.notes,
      })),
      staleCount,
    };
  });

  /** Registra um acerto: quem pagou (padrão: você) e quem recebeu. */
  app.post('/couple/settlements', async (request, reply) => {
    const spaceId = spaceIdOf(request);
    const body = settlementBodySchema.parse(request.body ?? {});
    const from = body.fromUserId ?? currentUser(request).id;
    const { members } = await sharedMembers(db, spaceId);
    const ids = new Set(members.map((m) => m.userId));
    if (!ids.has(from) || !ids.has(body.toUserId) || from === body.toUserId) {
      throw badRequest('invalid_settlement', 'Escolha dois membros diferentes do espaço.');
    }
    const [row] = await db
      .insert(spaceSettlements)
      .values({
        spaceId,
        fromUserId: from,
        toUserId: body.toUserId,
        amount: body.amount,
        date: body.date ?? today(),
        notes: body.notes ?? null,
        createdBy: currentUser(request).id,
      })
      .returning();
    return reply.code(201).send(row);
  });

  app.delete('/couple/settlements/:id', async (request, reply) => {
    const { spaceId, id } = spaceItemParamsSchema.parse(request.params);
    const [row] = await db
      .update(spaceSettlements)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(spaceSettlements.id, id),
          eq(spaceSettlements.spaceId, spaceId),
          isNull(spaceSettlements.deletedAt),
        ),
      )
      .returning({ id: spaceSettlements.id });
    if (!row) throw notFound('Acerto');
    return reply.code(204).send();
  });
}
