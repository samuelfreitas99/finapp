import { NOTIFICATION_TYPES } from '@finapp/shared';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, id, inList, updatedAt } from './_helpers';
import { users } from './auth';
import { spaces } from './spaces';

/** Inscrições de Web Push (uma por navegador/aparelho). */
export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull().unique(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('push_subscriptions_user_idx').on(t.userId)],
);

/**
 * Preferências por tipo de alerta. Sem linha = padrão (ligado, 3 dias antes).
 * Horário de silêncio `HH:MM` (pode atravessar a meia-noite).
 * @see RN 9
 */
export const notificationSettings = pgTable(
  'notification_settings',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type', { enum: NOTIFICATION_TYPES }).notNull(),
    enabled: boolean('enabled').notNull().default(true),
    daysBefore: integer('days_before').notNull().default(3),
    quietStart: text('quiet_start'),
    quietEnd: text('quiet_end'),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.type] }),
    check('notification_settings_type_check', inList(t.type, NOTIFICATION_TYPES)),
    check('notification_settings_days_check', sql`${t.daysBefore} between 0 and 30`),
    check(
      'notification_settings_quiet_check',
      sql`(${t.quietStart} is null or ${t.quietStart} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') and (${t.quietEnd} is null or ${t.quietEnd} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')`,
    ),
  ],
);

/**
 * Central de notificações. `dedupe_key` (tipo+entidade+data) garante um alerta por
 * evento; `sent_at` marca o envio por push.
 * @see RN 9
 */
export const notifications = pgTable(
  'notifications',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    spaceId: uuid('space_id').references(() => spaces.id, { onDelete: 'cascade' }),
    type: text('type', { enum: NOTIFICATION_TYPES }).notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    /** Caminho no app para abrir ao tocar (ex.: `/cartoes?cartao=...`). */
    url: text('url'),
    entityType: text('entity_type'),
    entityId: uuid('entity_id'),
    dedupeKey: text('dedupe_key').notNull().unique(),
    readAt: timestamp('read_at', { withTimezone: true }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index('notifications_user_created_idx').on(t.userId, t.createdAt),
    check('notifications_type_check', inList(t.type, NOTIFICATION_TYPES)),
  ],
);
