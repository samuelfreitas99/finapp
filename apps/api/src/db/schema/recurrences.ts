import {
  BUSINESS_DAY_ADJUSTS,
  PAYMENT_METHODS,
  RECURRENCE_FREQUENCIES,
  TRANSACTION_TYPES,
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
  pgTable,
  text,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, deletedAt, id, inList, updatedAt } from './_helpers';
import { users } from './auth';
import { creditCards } from './cards';
import { accounts, categories } from './registry';
import { spaces } from './spaces';

/** Regra do dia, gravada como JSON (`{ kind, day?, n? }`). @see RN 3 */
export type DayRuleJson =
  | { kind: 'fixed_day'; day: number }
  | { kind: 'nth_business_day'; n: number }
  | { kind: 'last_business_day' };

/** Parte de um valor dividido (salário em partes). */
export interface RecurrencePartJson {
  label?: string;
  amount?: number;
  percent?: number;
  dayRule: DayRuleJson;
  adjust?: 'none' | 'previous' | 'next';
  monthOffset?: number;
}

/**
 * Recorrências: receitas e despesas fixas que geram lançamentos previstos para frente
 * (janela de 12 meses). Destino: conta **ou** cartão.
 * @see RN 3
 */
export const recurrences = pgTable(
  'recurrences',
  {
    id: id(),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    deletedAt: deletedAt(),
    type: text('type', { enum: TRANSACTION_TYPES }).notNull(),
    description: text('description').notNull(),
    amount: bigint('amount', { mode: 'number' }).notNull(),
    frequency: text('frequency', { enum: RECURRENCE_FREQUENCIES }).notNull(),
    interval: integer('interval').notNull().default(1),
    dayRule: jsonb('day_rule').$type<DayRuleJson>(),
    adjust: text('adjust', { enum: BUSINESS_DAY_ADJUSTS }).notNull().default('none'),
    parts: jsonb('parts').$type<RecurrencePartJson[]>(),
    startDate: date('start_date', { mode: 'string' }).notNull(),
    endDate: date('end_date', { mode: 'string' }),
    accountId: uuid('account_id').references(() => accounts.id),
    cardId: uuid('card_id').references(() => creditCards.id),
    categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'set null' }),
    paymentMethod: text('payment_method', { enum: PAYMENT_METHODS }),
    /** Conta variável (luz, água): o previsto é estimado e confirmado com o valor real. */
    variableAmount: boolean('variable_amount').notNull().default(false),
    /** Até onde os lançamentos já foram gerados (o job estende a janela). */
    generatedUntil: date('generated_until', { mode: 'string' }),
  },
  (t) => [
    index('recurrences_space_idx').on(t.spaceId, t.deletedAt),
    check('recurrences_type_check', sql`${t.type} in ('income', 'expense')`),
    check('recurrences_frequency_check', inList(t.frequency, RECURRENCE_FREQUENCIES)),
    check('recurrences_adjust_check', inList(t.adjust, BUSINESS_DAY_ADJUSTS)),
    check(
      'recurrences_payment_method_check',
      sql`${t.paymentMethod} is null or ${inList(t.paymentMethod, PAYMENT_METHODS)}`,
    ),
    check('recurrences_amount_check', sql`${t.amount} > 0`),
    check('recurrences_interval_check', sql`${t.interval} between 1 and 120`),
    check('recurrences_dates_check', sql`${t.endDate} is null or ${t.endDate} >= ${t.startDate}`),
    check('recurrences_account_xor_card', sql`(${t.accountId} is null) <> (${t.cardId} is null)`),
    check(
      'recurrences_rule_check',
      sql`${t.dayRule} is not null or ${t.parts} is not null or ${t.frequency} = 'weekly'`,
    ),
  ],
);
