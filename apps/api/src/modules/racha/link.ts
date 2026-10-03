import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { spaceRole } from '../spaces/access';
import {
  accounts,
  splitExpensePostings,
  splitExpenseShares,
  splitExpenses,
  splitGroupLinks,
  splitGroups,
  splitParticipants,
  transactions,
} from '../../db/schema';

type Link = typeof splitGroupLinks.$inferSelect;

export interface SyncResult {
  created: number;
  updated: number;
  removed: number;
}

/**
 * Faz a **parte do usuário** em cada despesa do grupo virar um lançamento efetivado na conta
 * escolhida (RN 11). É idempotente: roda de novo e só ajusta o que mudou. O que o usuário
 * apagou do lançamento não é recriado; despesa excluída ou parte zerada some do espaço.
 *
 * O lançamento é o custo da pessoa (o saldo da conta passa a incluir o que ela deve ou tem
 * a receber no racha); por isso acertos entre amigos não geram lançamento.
 */
export async function syncGroupLink(db: Db, link: Link): Promise<SyncResult> {
  const result: SyncResult = { created: 0, updated: 0, removed: 0 };
  const [group] = await db.select().from(splitGroups).where(eq(splitGroups.id, link.groupId));
  const [account] = await db
    .select()
    .from(accounts)
    .where(
      and(
        eq(accounts.id, link.accountId),
        eq(accounts.spaceId, link.spaceId),
        isNull(accounts.deletedAt),
      ),
    );
  const [me] = await db
    .select()
    .from(splitParticipants)
    .where(
      and(eq(splitParticipants.groupId, link.groupId), eq(splitParticipants.userId, link.userId)),
    );
  // Quem saiu do espaço (ou o espaço foi excluído) não lança mais nele.
  const member = await spaceRole(db, link.userId, link.spaceId);
  if (!group || !account || !me || !member) return result;

  const expenses = await db
    .select()
    .from(splitExpenses)
    .where(and(eq(splitExpenses.groupId, link.groupId), isNull(splitExpenses.deletedAt)));
  const shares = expenses.length
    ? await db
        .select()
        .from(splitExpenseShares)
        .where(
          and(
            inArray(
              splitExpenseShares.expenseId,
              expenses.map((e) => e.id),
            ),
            eq(splitExpenseShares.participantId, me.id),
          ),
        )
    : [];
  const mine = new Map(shares.map((s) => [s.expenseId, s.amount]));

  const postings = await db
    .select({
      expenseId: splitExpensePostings.expenseId,
      transactionId: splitExpensePostings.transactionId,
      deletedAt: transactions.deletedAt,
    })
    .from(splitExpensePostings)
    .innerJoin(transactions, eq(transactions.id, splitExpensePostings.transactionId))
    .innerJoin(splitExpenses, eq(splitExpenses.id, splitExpensePostings.expenseId))
    .where(
      and(eq(splitExpensePostings.userId, link.userId), eq(splitExpenses.groupId, link.groupId)),
    );
  const posted = new Map(postings.map((p) => [p.expenseId, p]));
  const live = new Set(expenses.map((e) => e.id));

  for (const e of expenses) {
    const amount = mine.get(e.id) ?? 0;
    const existing = posted.get(e.id);
    if (existing) {
      if (existing.deletedAt) continue; // o usuário apagou: respeita
      if (amount <= 0) {
        await db
          .update(transactions)
          .set({ deletedAt: new Date() })
          .where(eq(transactions.id, existing.transactionId));
        result.removed++;
        continue;
      }
      const [tx] = await db
        .select()
        .from(transactions)
        .where(eq(transactions.id, existing.transactionId));
      if (tx && (tx.amount !== amount || tx.date !== e.date)) {
        await db
          .update(transactions)
          .set({ amount, date: e.date })
          .where(eq(transactions.id, tx.id));
        result.updated++;
      }
      continue;
    }
    if (amount <= 0 || e.date < account.initialDate) continue;
    const [tx] = await db
      .insert(transactions)
      .values({
        spaceId: link.spaceId,
        type: 'expense',
        status: 'settled',
        amount,
        date: e.date,
        description: `Racha ${group.name}: ${e.description}`.slice(0, 200),
        categoryId: link.categoryId,
        accountId: account.id,
        settledAt: new Date(),
        createdBy: link.userId,
      })
      .returning({ id: transactions.id });
    if (!tx) continue;
    await db
      .insert(splitExpensePostings)
      .values({ expenseId: e.id, userId: link.userId, transactionId: tx.id });
    result.created++;
  }

  // Despesas excluídas do grupo: o lançamento correspondente sai do espaço.
  for (const [expenseId, p] of posted) {
    if (live.has(expenseId) || p.deletedAt) continue;
    await db
      .update(transactions)
      .set({ deletedAt: new Date() })
      .where(eq(transactions.id, p.transactionId));
    result.removed++;
  }
  return result;
}

/** Sincroniza todos os usuários que ligaram o grupo ao espaço pessoal (melhor esforço). */
export async function syncAllLinks(db: Db, groupId: string): Promise<void> {
  const links = await db.select().from(splitGroupLinks).where(eq(splitGroupLinks.groupId, groupId));
  for (const link of links) {
    try {
      await syncGroupLink(db, link);
    } catch {
      // A sincronização de um amigo não pode quebrar a despesa de quem está lançando.
    }
  }
}
