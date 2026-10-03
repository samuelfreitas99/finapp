import { bigint, customType, index, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { createdAt, deletedAt, id } from './_helpers';
import { users } from './auth';
import { spaces } from './spaces';
import { transactions } from './transactions';

const bytea = customType<{ data: Buffer }>({
  dataType: () => 'bytea',
});

/**
 * Comprovantes (foto ou PDF) de um lançamento. O arquivo fica no próprio Postgres (`data`),
 * o que o deixa dentro do backup diário; limite de tamanho na API. Exclusão lógica.
 * @see docs/decisoes.md (ADR-016)
 */
export const attachments = pgTable(
  'attachments',
  {
    id: id(),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    transactionId: uuid('transaction_id')
      .notNull()
      .references(() => transactions.id),
    fileName: text('file_name').notNull(),
    mime: text('mime').notNull(),
    size: bigint('size', { mode: 'number' }).notNull(),
    data: bytea('data').notNull(),
    createdAt: createdAt(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    deletedAt: deletedAt(),
  },
  (t) => [index('attachments_transaction_idx').on(t.transactionId, t.deletedAt)],
);
