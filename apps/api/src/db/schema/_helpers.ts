import { sql, type AnyColumn } from 'drizzle-orm';
import { timestamp, uuid } from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';

/** PK uuid v7, gerado no app (ordenável por tempo). */
export const id = () =>
  uuid('id')
    .primaryKey()
    .$defaultFn(() => uuidv7());

export const createdAt = () =>
  timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export const deletedAt = () => timestamp('deleted_at', { withTimezone: true });

/** Check constraint `coluna in (...)` para colunas "enum" em text. */
export const inList = (column: AnyColumn, values: readonly string[]) =>
  sql`${column} in (${sql.raw(values.map((v) => `'${v.replace(/'/g, "''")}'`).join(', '))})`;
