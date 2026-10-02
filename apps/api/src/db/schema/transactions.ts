import { PAYMENT_METHODS, TRANSACTION_STATUSES, TRANSACTION_TYPES } from '@finapp/shared';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, deletedAt, id, inList, updatedAt } from './_helpers';
import { users } from './auth';
import { accounts, categories, contacts, tags } from './registry';
import { spaces } from './spaces';

/**
 * Lançamentos (receitas, despesas, transferências, ajustes). Valor sempre positivo em
 * centavos; o tipo define o sentido. Fica numa conta **ou** numa fatura (cartão).
 * As colunas que apontam para tabelas de fases futuras (faturas, cartões, parcelamentos,
 * recorrências, dívidas, racha) ganham chave estrangeira na migração de cada fase.
 * @see RN 1, docs/modelo-de-dados.md
 */
export const transactions = pgTable(
  'transactions',
  {
    id: id(),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    type: text('type', { enum: TRANSACTION_TYPES }).notNull(),
    status: text('status', { enum: TRANSACTION_STATUSES }).notNull(),
    amount: bigint('amount', { mode: 'number' }).notNull(),
    date: date('date', { mode: 'string' }).notNull(),
    description: text('description').notNull(),
    notes: text('notes'),
    categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'set null' }),
    accountId: uuid('account_id').references(() => accounts.id),
    invoiceId: uuid('invoice_id'),
    cardId: uuid('card_id'),
    paymentMethod: text('payment_method', { enum: PAYMENT_METHODS }),
    pixCounterparty: text('pix_counterparty'),
    contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
    /** Liga as duas pontas de uma transferência. */
    transferId: uuid('transfer_id'),
    installmentPlanId: uuid('installment_plan_id'),
    installmentNumber: integer('installment_number'),
    recurrenceId: uuid('recurrence_id'),
    /** Ocorrência editada individualmente: o job de recorrência não sobrescreve. */
    detached: boolean('detached').notNull().default(false),
    debtInstallmentId: uuid('debt_installment_id'),
    invoicePaymentId: uuid('invoice_payment_id'),
    splitId: uuid('split_id'),
    /** Valor estimado (conta variável), confirmado com o valor real depois. */
    estimated: boolean('estimated').notNull().default(false),
    reconciledAt: timestamp('reconciled_at', { withTimezone: true }),
    settledAt: timestamp('settled_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    deletedAt: deletedAt(),
  },
  (t) => [
    index('transactions_space_date_idx').on(t.spaceId, t.date),
    index('transactions_space_deleted_idx').on(t.spaceId, t.deletedAt),
    index('transactions_account_idx').on(t.accountId),
    index('transactions_category_idx').on(t.categoryId),
    index('transactions_invoice_idx').on(t.invoiceId),
    index('transactions_transfer_idx').on(t.transferId),
    check('transactions_type_check', inList(t.type, TRANSACTION_TYPES)),
    check('transactions_status_check', inList(t.status, TRANSACTION_STATUSES)),
    check(
      'transactions_payment_method_check',
      sql`${t.paymentMethod} is null or ${inList(t.paymentMethod, PAYMENT_METHODS)}`,
    ),
    check('transactions_amount_positive', sql`${t.amount} > 0`),
    check(
      'transactions_account_xor_invoice',
      sql`(${t.accountId} is null) <> (${t.invoiceId} is null)`,
    ),
  ],
);

export const transactionTags = pgTable(
  'transaction_tags',
  {
    transactionId: uuid('transaction_id')
      .notNull()
      .references(() => transactions.id, { onDelete: 'cascade' }),
    tagId: uuid('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.transactionId, t.tagId] }),
    index('transaction_tags_tag_idx').on(t.tagId),
  ],
);
