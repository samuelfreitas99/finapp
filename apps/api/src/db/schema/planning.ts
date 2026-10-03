import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, deletedAt, id, updatedAt } from './_helpers';
import { users } from './auth';
import { categories } from './registry';
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
