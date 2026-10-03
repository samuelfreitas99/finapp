import type { ISODate } from '@finapp/core';
import { and, eq, isNotNull, isNull, lte } from 'drizzle-orm';
import type { Db } from '../db/client';
import { transactions } from '../db/schema';
import { recordInstallmentPayment } from '../modules/debts/service';

/**
 * Dívida paga no cartão: a parcela que chegou no vencimento já está na fatura, então o item
 * vira efetivado e a parcela conta como paga. Roda todo dia (idempotente).
 * @see RN 6.6
 */
export async function settleDueCardInstallments(db: Db, today: ISODate): Promise<number> {
  const due = await db
    .select()
    .from(transactions)
    .where(
      and(
        isNotNull(transactions.debtInstallmentId),
        isNotNull(transactions.cardId),
        eq(transactions.status, 'planned'),
        isNull(transactions.deletedAt),
        lte(transactions.date, today),
      ),
    );
  for (const t of due) {
    await db.transaction(async (tx) => {
      await tx
        .update(transactions)
        .set({ status: 'settled', settledAt: new Date(), estimated: false })
        .where(eq(transactions.id, t.id));
      await recordInstallmentPayment(tx, {
        installmentId: t.debtInstallmentId as string,
        amount: t.amount,
        date: t.date,
        transactionId: t.id,
        today,
        userId: null,
      });
    });
  }
  return due.length;
}
