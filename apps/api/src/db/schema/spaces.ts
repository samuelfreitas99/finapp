import { SPACE_ROLES, SPACE_TYPES, THEMES } from '@finapp/shared';
import {
  boolean,
  check,
  index,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, deletedAt, id, inList, updatedAt } from './_helpers';
import { users } from './auth';

/** Dono dos dados: todo usuário tem um espaço pessoal; espaços compartilhados têm membros. */
export const spaces = pgTable(
  'spaces',
  {
    id: id(),
    name: text('name').notNull(),
    type: text('type', { enum: SPACE_TYPES }).notNull(),
    /** Divisão padrão das despesas no espaço compartilhado (RN 10). */
    defaultSplit: jsonb('default_split'),
    currency: text('currency').notNull().default('BRL'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [check('spaces_type_check', inList(t.type, SPACE_TYPES))],
);

export const spaceMembers = pgTable(
  'space_members',
  {
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role', { enum: SPACE_ROLES }).notNull().default('member'),
    splitPercent: numeric('split_percent', { precision: 5, scale: 2, mode: 'number' }),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.spaceId, t.userId] }),
    index('space_members_user_id_idx').on(t.userId),
    check('space_members_role_check', inList(t.role, SPACE_ROLES)),
  ],
);

/** Convites: cadastro só com código (opcionalmente já ligado a um espaço). */
export const invites = pgTable('invites', {
  id: id(),
  code: text('code').notNull().unique(),
  /** Nulo = convite criado pelo administrador do servidor (CLI). */
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  spaceId: uuid('space_id').references(() => spaces.id, { onDelete: 'cascade' }),
  email: text('email'),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  usedBy: uuid('used_by').references(() => users.id),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: createdAt(),
});

export const userSettings = pgTable(
  'user_settings',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    theme: text('theme', { enum: THEMES }).notNull().default('system'),
    hideValues: boolean('hide_values').notNull().default(false),
    activeSpaceId: uuid('active_space_id').references(() => spaces.id, { onDelete: 'set null' }),
    lockPinHash: text('lock_pin_hash'),
    updatedAt: updatedAt(),
  },
  (t) => [check('user_settings_theme_check', inList(t.theme, THEMES))],
);
