import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, deletedAt, id, inList, updatedAt } from './_helpers';
import { users } from './auth';
import { accounts, categories } from './registry';
import { spaces } from './spaces';
import { transactions } from './transactions';

const SPLIT_MODES = ['equal', 'percent', 'amount', 'shares'] as const;

/**
 * Racha entre amigos (RN 11): grupos de divisão fora de qualquer espaço. O acesso é por
 * `split_participants.user_id`; quem não tem conta entra só com o nome.
 */
export const splitGroups = pgTable(
  'split_groups',
  {
    id: id(),
    name: text('name').notNull(),
    currency: text('currency').notNull().default('BRL'),
    /** Código para amigos com conta entrarem no grupo. */
    joinCode: text('join_code').notNull().unique(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('split_groups_created_by_idx').on(t.createdBy)],
);

export const splitParticipants = pgTable(
  'split_participants',
  {
    id: id(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => splitGroups.id, { onDelete: 'cascade' }),
    /** Nulo = pessoa sem conta (só o nome). */
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('split_participants_group_idx').on(t.groupId),
    index('split_participants_user_idx').on(t.userId),
    uniqueIndex('split_participants_group_user_uq')
      .on(t.groupId, t.userId)
      .where(sql`${t.userId} is not null`),
  ],
);

export const splitExpenses = pgTable(
  'split_expenses',
  {
    id: id(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => splitGroups.id, { onDelete: 'cascade' }),
    description: text('description').notNull(),
    amount: bigint('amount', { mode: 'number' }).notNull(),
    date: date('date', { mode: 'string' }).notNull(),
    splitMode: text('split_mode', { enum: SPLIT_MODES }).notNull(),
    category: text('category'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    index('split_expenses_group_idx').on(t.groupId, t.deletedAt),
    check('split_expenses_amount_check', sql`${t.amount} > 0`),
    check('split_expenses_mode_check', inList(t.splitMode, SPLIT_MODES)),
  ],
);

/** Quem pagou a despesa e quanto (pode ser mais de uma pessoa). */
export const splitExpensePayers = pgTable(
  'split_expense_payers',
  {
    expenseId: uuid('expense_id')
      .notNull()
      .references(() => splitExpenses.id, { onDelete: 'cascade' }),
    participantId: uuid('participant_id')
      .notNull()
      .references(() => splitParticipants.id),
    amount: bigint('amount', { mode: 'number' }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.expenseId, t.participantId] }),
    check('split_expense_payers_amount_check', sql`${t.amount} > 0`),
  ],
);

/** Quanto cada participante deve da despesa (peso só no modo `shares`). */
export const splitExpenseShares = pgTable(
  'split_expense_shares',
  {
    expenseId: uuid('expense_id')
      .notNull()
      .references(() => splitExpenses.id, { onDelete: 'cascade' }),
    participantId: uuid('participant_id')
      .notNull()
      .references(() => splitParticipants.id),
    amount: bigint('amount', { mode: 'number' }).notNull(),
    weight: integer('weight'),
  },
  (t) => [
    primaryKey({ columns: [t.expenseId, t.participantId] }),
    check('split_expense_shares_amount_check', sql`${t.amount} >= 0`),
  ],
);

/** Acerto: `from` pagou `to` (Pix, dinheiro) e o saldo diminui. */
export const splitSettlements = pgTable(
  'split_settlements',
  {
    id: id(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => splitGroups.id, { onDelete: 'cascade' }),
    fromParticipantId: uuid('from_participant_id')
      .notNull()
      .references(() => splitParticipants.id),
    toParticipantId: uuid('to_participant_id')
      .notNull()
      .references(() => splitParticipants.id),
    amount: bigint('amount', { mode: 'number' }).notNull(),
    date: date('date', { mode: 'string' }).notNull(),
    method: text('method'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    index('split_settlements_group_idx').on(t.groupId, t.deletedAt),
    check('split_settlements_amount_check', sql`${t.amount} > 0`),
    check('split_settlements_parties_check', sql`${t.fromParticipantId} <> ${t.toParticipantId}`),
  ],
);

/**
 * Integração opcional do racha com o espaço pessoal (RN 11): o usuário escolhe em qual
 * espaço/conta a **parte dele** de cada despesa do grupo vira lançamento.
 */
export const splitGroupLinks = pgTable(
  'split_group_links',
  {
    id: id(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => splitGroups.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('split_group_links_group_user_uq').on(t.groupId, t.userId)],
);

/** Qual lançamento representa a parte do usuário em cada despesa (evita duplicar ao sincronizar). */
export const splitExpensePostings = pgTable(
  'split_expense_postings',
  {
    expenseId: uuid('expense_id')
      .notNull()
      .references(() => splitExpenses.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    transactionId: uuid('transaction_id')
      .notNull()
      .references(() => transactions.id),
  },
  (t) => [primaryKey({ columns: [t.expenseId, t.userId] })],
);
