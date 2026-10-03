import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { id } from './_helpers';
import { users } from './auth';
import { spaces } from './spaces';

/**
 * Histórico de alterações do espaço: quem mudou o quê e quando. Uma linha por requisição
 * de escrita bem-sucedida. `after` guarda o corpo enviado (sem campos sensíveis).
 * Nunca é apagado pelo app.
 */
export const auditLog = pgTable(
  'audit_log',
  {
    id: id(),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id'),
    /** `create`, `update`, `delete` ou o verbo da rota (`settle`, `pay`, `cancel`...). */
    action: text('action').notNull(),
    before: jsonb('before'),
    after: jsonb('after'),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_log_space_idx').on(t.spaceId, t.id),
    index('audit_log_entity_idx').on(t.entityType, t.entityId),
  ],
);
