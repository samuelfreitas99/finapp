import { CARD_BRANDS, INSTALLMENT_PLAN_STATUSES, INVOICE_STATUSES } from '@finapp/shared';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { createdAt, deletedAt, id, inList, updatedAt } from './_helpers';
import { users } from './auth';
import { accounts, categories } from './registry';
import { spaces } from './spaces';
import { transactions } from './transactions';

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

/**
 * Cartões de crédito. Dias de fechamento/vencimento 1–31 (com clamp no mês curto).
 * `parent_card_id`: cartão adicional, que divide o limite do titular.
 * @see RN 4
 */
export const creditCards = pgTable(
  'credit_cards',
  {
    ...domain(),
    name: text('name').notNull(),
    brand: text('brand', { enum: CARD_BRANDS }),
    limitAmount: bigint('limit_amount', { mode: 'number' }).notNull(),
    closingDay: integer('closing_day').notNull(),
    dueDay: integer('due_day').notNull(),
    /** Compra no dia do fechamento já vai para a próxima fatura (padrão dos bancos). */
    closingDayGoesToNext: boolean('closing_day_goes_to_next').notNull().default(true),
    /** Conta sugerida para pagar a fatura. */
    paymentAccountId: uuid('payment_account_id').references(() => accounts.id, {
      onDelete: 'set null',
    }),
    color: text('color'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    parentCardId: uuid('parent_card_id').references((): AnyPgColumn => creditCards.id, {
      onDelete: 'set null',
    }),
  },
  (t) => [
    index('credit_cards_space_idx').on(t.spaceId, t.deletedAt),
    check('credit_cards_brand_check', sql`${t.brand} is null or ${inList(t.brand, CARD_BRANDS)}`),
    check('credit_cards_limit_check', sql`${t.limitAmount} >= 0`),
    check('credit_cards_closing_day_check', sql`${t.closingDay} between 1 and 31`),
    check('credit_cards_due_day_check', sql`${t.dueDay} between 1 and 31`),
  ],
);

/**
 * Faturas, identificadas pelo mês de vencimento (`reference_month`, `YYYY-MM`).
 * As datas gravadas já consideram os overrides; o total é a soma dos itens
 * (`transactions.invoice_id`), calculado na consulta, nunca armazenado.
 * @see RN 4
 */
export const invoices = pgTable(
  'invoices',
  {
    ...domain(),
    cardId: uuid('card_id')
      .notNull()
      .references(() => creditCards.id, { onDelete: 'cascade' }),
    referenceMonth: text('reference_month').notNull(),
    closingDate: date('closing_date', { mode: 'string' }).notNull(),
    dueDate: date('due_date', { mode: 'string' }).notNull(),
    closingDateOverride: date('closing_date_override', { mode: 'string' }),
    dueDateOverride: date('due_date_override', { mode: 'string' }),
    /** Último estado calculado (o core recalcula a partir das datas, total e pagamentos). */
    status: text('status', { enum: INVOICE_STATUSES }).notNull().default('open'),
    /** Saldo não pago trazido da fatura anterior (vira o item "Saldo anterior"). */
    carriedBalance: bigint('carried_balance', { mode: 'number' }).notNull().default(0),
  },
  (t) => [
    unique('invoices_card_month_uq').on(t.cardId, t.referenceMonth),
    index('invoices_space_due_idx').on(t.spaceId, t.dueDate),
    check(
      'invoices_reference_month_check',
      sql`${t.referenceMonth} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`,
    ),
    check('invoices_status_check', inList(t.status, INVOICE_STATUSES)),
    check('invoices_dates_check', sql`${t.closingDate} <= ${t.dueDate}`),
  ],
);

/**
 * Pagamentos de fatura (pode haver vários). Cada um tem o lançamento de despesa na conta
 * (categoria técnica "Pagamento de fatura").
 * @see RN 4 (Pagar fatura)
 */
export const invoicePayments = pgTable(
  'invoice_payments',
  {
    ...domain(),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'cascade' }),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    amount: bigint('amount', { mode: 'number' }).notNull(),
    date: date('date', { mode: 'string' }).notNull(),
    transactionId: uuid('transaction_id').references((): AnyPgColumn => transactions.id, {
      onDelete: 'set null',
    }),
  },
  (t) => [
    index('invoice_payments_invoice_idx').on(t.invoiceId),
    check('invoice_payments_amount_check', sql`${t.amount} > 0`),
  ],
);

/**
 * Compras parceladas: no cartão (`card_id`) **ou** fora dele, carnê/boleto (`account_id`).
 * As parcelas são lançamentos com `installment_plan_id` e `installment_number`.
 * @see RN 5
 */
export const installmentPlans = pgTable(
  'installment_plans',
  {
    ...domain(),
    description: text('description').notNull(),
    totalAmount: bigint('total_amount', { mode: 'number' }).notNull(),
    installments: integer('installments').notNull(),
    /** Data da compra. */
    firstDate: date('first_date', { mode: 'string' }).notNull(),
    /** Vencimento da 1ª parcela (fora do cartão). */
    firstDueDate: date('first_due_date', { mode: 'string' }),
    cardId: uuid('card_id').references(() => creditCards.id),
    accountId: uuid('account_id').references(() => accounts.id),
    categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'set null' }),
    /** Juros embutidos no parcelamento (informativo). */
    interestAmount: bigint('interest_amount', { mode: 'number' }).notNull().default(0),
    /** Plano cadastrado em andamento: primeira parcela criada (RN 5.3). */
    startInstallment: integer('start_installment').notNull().default(1),
    status: text('status', { enum: INSTALLMENT_PLAN_STATUSES }).notNull().default('active'),
  },
  (t) => [
    index('installment_plans_space_idx').on(t.spaceId, t.deletedAt),
    check('installment_plans_status_check', inList(t.status, INSTALLMENT_PLAN_STATUSES)),
    check('installment_plans_total_check', sql`${t.totalAmount} > 0`),
    check('installment_plans_installments_check', sql`${t.installments} between 1 and 420`),
    check(
      'installment_plans_start_check',
      sql`${t.startInstallment} between 1 and ${t.installments}`,
    ),
    check(
      'installment_plans_card_xor_account',
      sql`(${t.cardId} is null) <> (${t.accountId} is null)`,
    ),
    check('installment_plans_interest_check', sql`${t.interestAmount} >= 0`),
  ],
);
