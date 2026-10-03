import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, deletedAt, id, updatedAt } from './_helpers';
import { users } from './auth';
import { accounts, categories } from './registry';
import { spaces } from './spaces';

/**
 * Orçamento: limite mensal de uma categoria de despesa (a categoria-mãe inclui as
 * subcategorias). `month` nulo vale para todo mês; uma linha com `month` sobrepõe a geral
 * naquele mês.
 * @see RN 8
 */
export const budgets = pgTable(
  'budgets',
  {
    id: id(),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id),
    /** `YYYY-MM`; nulo = todo mês. */
    month: text('month'),
    amount: bigint('amount', { mode: 'number' }).notNull(),
    /** Acumula a sobra do mês para o seguinte. */
    rollover: boolean('rollover').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    deletedAt: deletedAt(),
  },
  (t) => [
    index('budgets_space_idx').on(t.spaceId, t.deletedAt),
    uniqueIndex('budgets_category_month_uq')
      .on(t.spaceId, t.categoryId, sql`coalesce(${t.month}, '')`)
      .where(sql`${t.deletedAt} is null`),
    check('budgets_amount_check', sql`${t.amount} >= 0`),
    check(
      'budgets_month_check',
      sql`${t.month} is null or ${t.month} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`,
    ),
  ],
);

/**
 * Meta de poupança. Com conta vinculada, o guardado é o saldo dela; sem conta, vale o
 * valor marcado à mão (`saved_amount_manual`).
 * @see RN 8
 */
export const goals = pgTable(
  'goals',
  {
    id: id(),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    targetAmount: bigint('target_amount', { mode: 'number' }).notNull(),
    targetDate: date('target_date', { mode: 'string' }),
    accountId: uuid('account_id').references(() => accounts.id),
    savedAmountManual: bigint('saved_amount_manual', { mode: 'number' }).notNull().default(0),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    deletedAt: deletedAt(),
  },
  (t) => [
    index('goals_space_idx').on(t.spaceId, t.deletedAt),
    check('goals_target_check', sql`${t.targetAmount} > 0`),
    check('goals_saved_check', sql`${t.savedAmountManual} >= 0`),
  ],
);
