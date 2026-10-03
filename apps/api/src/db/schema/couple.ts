import { sql } from 'drizzle-orm';
import { bigint, check, date, index, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, deletedAt, id } from './_helpers';
import { users } from './auth';
import { spaces } from './spaces';
import { transactions } from './transactions';

/**
 * Divisão de uma despesa do espaço compartilhado: a parte de cada membro e quem pagou
 * com dinheiro próprio (a diferença vira saldo entre os membros). Uma linha por membro.
 * @see RN 10
 */
export const transactionSplits = pgTable(
  'transaction_splits',
  {
    id: id(),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    transactionId: uuid('transaction_id')
      .notNull()
      .references(() => transactions.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Quanto este membro deve da despesa (pode ser 0). */
    amount: bigint('amount', { mode: 'number' }).notNull(),
    paidByUserId: uuid('paid_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('transaction_splits_tx_user_uq').on(t.transactionId, t.userId),
    index('transaction_splits_space_idx').on(t.spaceId),
    check('transaction_splits_amount_check', sql`${t.amount} >= 0`),
  ],
);

/** Acerto entre membros: `from` pagou `to` (Pix, dinheiro) e o saldo diminui. */
export const spaceSettlements = pgTable(
  'space_settlements',
  {
    id: id(),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    fromUserId: uuid('from_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    toUserId: uuid('to_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    amount: bigint('amount', { mode: 'number' }).notNull(),
    date: date('date', { mode: 'string' }).notNull(),
    notes: text('notes'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    index('space_settlements_space_idx').on(t.spaceId, t.deletedAt),
    check('space_settlements_amount_check', sql`${t.amount} > 0`),
    check('space_settlements_parties_check', sql`${t.fromUserId} <> ${t.toUserId}`),
  ],
);
