import {
  DEBT_DIRECTIONS,
  DEBT_EVENT_TYPES,
  DEBT_INDEXES,
  DEBT_INSTALLMENT_STATUSES,
  DEBT_KINDS,
  DEBT_STATUSES,
  DEBT_SYSTEMS,
} from '@finapp/shared';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { createdAt, deletedAt, id, inList, updatedAt } from './_helpers';
import { users } from './auth';
import { creditCards } from './cards';
import { accounts, contacts } from './registry';
import { spaces } from './spaces';
import { transactions } from './transactions';

const owned = () => ({
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
 * Dívidas e empréstimos (devo / me devem). Pagas por conta **ou** por cartão (empréstimo
 * na fatura); imóvel na planta tem `completion_date` (entrega das chaves).
 * @see RN 6
 */
export const debts = pgTable(
  'debts',
  {
    ...owned(),
    name: text('name').notNull(),
    direction: text('direction', { enum: DEBT_DIRECTIONS }).notNull(),
    kind: text('kind', { enum: DEBT_KINDS }).notNull(),
    contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
    institution: text('institution'),
    /** Valor recebido/emprestado. */
    principal: bigint('principal', { mode: 'number' }).notNull().default(0),
    paymentAccountId: uuid('payment_account_id').references(() => accounts.id, {
      onDelete: 'set null',
    }),
    paymentCardId: uuid('payment_card_id').references(() => creditCards.id, {
      onDelete: 'set null',
    }),
    /** Imóvel na planta: entrega das chaves prevista (fim dos juros de obra). */
    completionDate: date('completion_date', { mode: 'string' }),
    /** Prazo máximo de entrega do contrato (pior caso). */
    completionDeadline: date('completion_deadline', { mode: 'string' }),
    /** A entrega já aconteceu ("Recebi as chaves"): a data deixa de ser estimativa. */
    completionConfirmed: boolean('completion_confirmed').notNull().default(false),
    /** Valor do bem (manual), para o patrimônio líquido. */
    assetValue: bigint('asset_value', { mode: 'number' }),
    status: text('status', { enum: DEBT_STATUSES }).notNull().default('active'),
    notes: text('notes'),
  },
  (t) => [
    index('debts_space_idx').on(t.spaceId, t.deletedAt),
    check('debts_direction_check', inList(t.direction, DEBT_DIRECTIONS)),
    check('debts_kind_check', inList(t.kind, DEBT_KINDS)),
    check('debts_status_check', inList(t.status, DEBT_STATUSES)),
    check('debts_principal_check', sql`${t.principal} >= 0`),
    check('debts_asset_value_check', sql`${t.assetValue} is null or ${t.assetValue} >= 0`),
    check(
      'debts_account_or_card',
      sql`${t.paymentAccountId} is null or ${t.paymentCardId} is null`,
    ),
  ],
);

/**
 * Fases da dívida (a maioria tem uma). Taxa mensal como decimal (0.01 = 1% a.m.).
 * `ends_at_completion`/`starts_after_completion` amarram a fase à entrega do imóvel.
 * @see RN 6.1, 6.7
 */
export const debtPhases = pgTable(
  'debt_phases',
  {
    ...owned(),
    debtId: uuid('debt_id')
      .notNull()
      .references(() => debts.id, { onDelete: 'cascade' }),
    /** Ordem da fase na dívida (1, 2, ...). */
    position: integer('position').notNull(),
    name: text('name').notNull(),
    system: text('system', { enum: DEBT_SYSTEMS }).notNull(),
    principal: bigint('principal', { mode: 'number' }),
    rateMonthly: numeric('rate_monthly', { precision: 16, scale: 12, mode: 'number' })
      .notNull()
      .default(0),
    index: text('index', { enum: DEBT_INDEXES }).notNull().default('none'),
    installments: integer('installments'),
    startDate: date('start_date', { mode: 'string' }).notNull(),
    endDate: date('end_date', { mode: 'string' }),
    installmentAmount: bigint('installment_amount', { mode: 'number' }),
    endsAtCompletion: boolean('ends_at_completion').notNull().default(false),
    startsAfterCompletion: boolean('starts_after_completion').notNull().default(false),
  },
  (t) => [
    unique('debt_phases_position_uq').on(t.debtId, t.position),
    check('debt_phases_system_check', inList(t.system, DEBT_SYSTEMS)),
    check('debt_phases_index_check', inList(t.index, DEBT_INDEXES)),
    check('debt_phases_rate_check', sql`${t.rateMonthly} >= 0 and ${t.rateMonthly} < 1`),
    check(
      'debt_phases_installments_check',
      sql`${t.installments} is null or ${t.installments} between 1 and 600`,
    ),
    check('debt_phases_principal_check', sql`${t.principal} is null or ${t.principal} >= 0`),
    check('debt_phases_dates_check', sql`${t.endDate} is null or ${t.endDate} >= ${t.startDate}`),
  ],
);

/**
 * Parcelas do cronograma. Pagar cria o lançamento (conta ou fatura) ligado por
 * `transactions.debt_installment_id`; `transaction_id` aponta para o pagamento.
 * @see RN 6.3
 */
export const debtInstallments = pgTable(
  'debt_installments',
  {
    ...owned(),
    debtId: uuid('debt_id')
      .notNull()
      .references(() => debts.id, { onDelete: 'cascade' }),
    phaseId: uuid('phase_id')
      .notNull()
      .references(() => debtPhases.id, { onDelete: 'cascade' }),
    number: integer('number').notNull(),
    dueDate: date('due_date', { mode: 'string' }).notNull(),
    amount: bigint('amount', { mode: 'number' }).notNull(),
    principalPart: bigint('principal_part', { mode: 'number' }).notNull().default(0),
    interestPart: bigint('interest_part', { mode: 'number' }).notNull().default(0),
    /** Valor estimado (fase `variable` sem valor informado). */
    estimated: boolean('estimated').notNull().default(false),
    paidAmount: bigint('paid_amount', { mode: 'number' }).notNull().default(0),
    paidDate: date('paid_date', { mode: 'string' }),
    discount: bigint('discount', { mode: 'number' }).notNull().default(0),
    status: text('status', { enum: DEBT_INSTALLMENT_STATUSES }).notNull().default('pending'),
    transactionId: uuid('transaction_id').references((): AnyPgColumn => transactions.id, {
      onDelete: 'set null',
    }),
  },
  (t) => [
    index('debt_installments_debt_due_idx').on(t.debtId, t.dueDate),
    index('debt_installments_space_due_idx').on(t.spaceId, t.dueDate),
    check('debt_installments_status_check', inList(t.status, DEBT_INSTALLMENT_STATUSES)),
    check('debt_installments_amount_check', sql`${t.amount} >= 0`),
    check('debt_installments_parts_check', sql`${t.principalPart} >= 0 and ${t.interestPart} >= 0`),
    check('debt_installments_paid_check', sql`${t.paidAmount} >= 0 and ${t.discount} >= 0`),
    check('debt_installments_number_check', sql`${t.number} >= 1`),
  ],
);

/** Histórico: amortizações, quitação, correções por índice, mudança da entrega. @see RN 6 */
export const debtEvents = pgTable(
  'debt_events',
  {
    id: id(),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    debtId: uuid('debt_id')
      .notNull()
      .references(() => debts.id, { onDelete: 'cascade' }),
    type: text('type', { enum: DEBT_EVENT_TYPES }).notNull(),
    amount: bigint('amount', { mode: 'number' }),
    date: date('date', { mode: 'string' }).notNull(),
    data: jsonb('data').$type<Record<string, unknown>>(),
    createdAt: createdAt(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    index('debt_events_debt_idx').on(t.debtId, t.date),
    check('debt_events_type_check', inList(t.type, DEBT_EVENT_TYPES)),
  ],
);

/**
 * Valores mensais dos índices (INCC, IPCA, IGP-M), compartilhados por todos os espaços.
 * `value` decimal do mês (0.0045 = 0,45%).
 * @see RN 6.2
 */
export const indexValues = pgTable(
  'index_values',
  {
    id: id(),
    index: text('index', { enum: DEBT_INDEXES }).notNull(),
    month: text('month').notNull(),
    value: numeric('value', { precision: 12, scale: 8, mode: 'number' }).notNull(),
    createdAt: createdAt(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    unique('index_values_index_month_uq').on(t.index, t.month),
    check('index_values_index_check', sql`${t.index} in ('incc', 'ipca', 'igpm')`),
    check('index_values_month_check', sql`${t.month} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
    check('index_values_value_check', sql`${t.value} > -1 and ${t.value} < 1`),
  ],
);
