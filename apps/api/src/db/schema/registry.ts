import { ACCOUNT_TYPES, CATEGORY_KINDS, SYSTEM_CATEGORY_KEYS } from '@finapp/shared';
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
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { createdAt, deletedAt, id, inList, updatedAt } from './_helpers';
import { users } from './auth';
import { spaces } from './spaces';

/** Colunas comuns de toda tabela de domínio (dados pertencem a um espaço). */
const domain = () => ({
  id: id(),
  spaceId: uuid('space_id')
    .notNull()
    .references(() => spaces.id, { onDelete: 'cascade' }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  deletedAt: deletedAt(),
});

/** Carteiras: onde o dinheiro está. Valores em centavos. */
export const accounts = pgTable(
  'accounts',
  {
    ...domain(),
    name: text('name').notNull(),
    type: text('type', { enum: ACCOUNT_TYPES }).notNull(),
    initialBalance: bigint('initial_balance', { mode: 'number' }).notNull().default(0),
    initialDate: date('initial_date', { mode: 'string' }).notNull(),
    color: text('color'),
    icon: text('icon'),
    includeInTotals: boolean('include_in_totals').notNull().default(true),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    /** No espaço compartilhado: de quem é a conta. */
    ownerUserId: uuid('owner_user_id').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    index('accounts_space_idx').on(t.spaceId, t.deletedAt),
    check('accounts_type_check', inList(t.type, ACCOUNT_TYPES)),
  ],
);

export const categories = pgTable(
  'categories',
  {
    ...domain(),
    name: text('name').notNull(),
    kind: text('kind', { enum: CATEGORY_KINDS }).notNull(),
    parentId: uuid('parent_id').references((): AnyPgColumn => categories.id, {
      onDelete: 'set null',
    }),
    icon: text('icon'),
    color: text('color'),
    isSystem: boolean('is_system').notNull().default(false),
    /** Identifica as categorias técnicas (pagamento de fatura, ajuste...). */
    systemKey: text('system_key', { enum: SYSTEM_CATEGORY_KEYS }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (t) => [
    index('categories_space_idx').on(t.spaceId, t.deletedAt),
    uniqueIndex('categories_space_system_key_uq')
      .on(t.spaceId, t.systemKey)
      .where(sql`${t.systemKey} is not null and ${t.deletedAt} is null`),
    check('categories_kind_check', inList(t.kind, CATEGORY_KINDS)),
    check(
      'categories_system_key_check',
      sql`${t.systemKey} is null or ${inList(t.systemKey, SYSTEM_CATEGORY_KEYS)}`,
    ),
  ],
);

/**
 * Regras de categoria da importação: descrição que contém `pattern` (sem diferenciar
 * maiúsculas e acentos) recebe a categoria. Vence o trecho mais longo.
 */
export const categoryRules = pgTable(
  'category_rules',
  {
    ...domain(),
    pattern: text('pattern').notNull(),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
  },
  (t) => [
    index('category_rules_space_idx').on(t.spaceId, t.deletedAt),
    uniqueIndex('category_rules_space_pattern_uq')
      .on(t.spaceId, t.pattern)
      .where(sql`${t.deletedAt} is null`),
  ],
);

export const tags = pgTable(
  'tags',
  {
    ...domain(),
    name: text('name').notNull(),
    color: text('color'),
  },
  (t) => [
    uniqueIndex('tags_space_name_uq')
      .on(t.spaceId, sql`lower(${t.name})`)
      .where(sql`${t.deletedAt} is null`),
  ],
);

export const contacts = pgTable(
  'contacts',
  {
    ...domain(),
    name: text('name').notNull(),
    pixKey: text('pix_key'),
    phone: text('phone'),
    linkedUserId: uuid('linked_user_id').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [index('contacts_space_idx').on(t.spaceId, t.deletedAt)],
);

/** Feriados: `space_id` nulo = nacional; os do espaço são locais (RN 2). */
export const holidays = pgTable(
  'holidays',
  {
    id: id(),
    spaceId: uuid('space_id').references(() => spaces.id, { onDelete: 'cascade' }),
    date: date('date', { mode: 'string' }).notNull(),
    name: text('name').notNull(),
    createdAt: createdAt(),
  },
  (t) => [unique('holidays_space_date_uq').on(t.spaceId, t.date).nullsNotDistinct()],
);
