import { z } from 'zod';
import { BUSINESS_DAY_ADJUSTS, PAYMENT_METHODS, RECURRENCE_FREQUENCIES } from '../enums';
import { isoDateSchema, nameSchema } from './common';

export const dayRuleSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('fixed_day'), day: z.int().min(1).max(31) }),
  z.object({ kind: z.literal('nth_business_day'), n: z.int().min(1).max(23) }),
  z.object({ kind: z.literal('last_business_day') }),
]);
export type DayRuleBody = z.infer<typeof dayRuleSchema>;

export const recurrencePartSchema = z
  .object({
    label: z.string().trim().max(60).optional(),
    amount: z.int().positive().optional(),
    percent: z.number().min(0).max(100).optional(),
    dayRule: dayRuleSchema,
    adjust: z.enum(BUSINESS_DAY_ADJUSTS).optional(),
    monthOffset: z.int().min(0).max(3).optional(),
  })
  .refine((p) => (p.amount === undefined) !== (p.percent === undefined), {
    message: 'cada parte tem valor ou percentual (só um)',
  });

const recurrenceFields = {
  type: z.enum(['income', 'expense']),
  description: nameSchema,
  amount: z.int().positive(),
  frequency: z.enum(RECURRENCE_FREQUENCIES),
  /** Para `every_n_months` (meses) e `weekly` (semanas). */
  interval: z.int().min(1).max(120).default(1),
  dayRule: dayRuleSchema.nullish(),
  adjust: z.enum(BUSINESS_DAY_ADJUSTS).default('none'),
  /** Salário em partes (só mensal/a cada N meses/anual). */
  parts: z.array(recurrencePartSchema).min(2).max(6).nullish(),
  startDate: isoDateSchema,
  endDate: isoDateSchema.nullish(),
  accountId: z.uuid().optional(),
  cardId: z.uuid().optional(),
  categoryId: z.uuid().nullish(),
  paymentMethod: z.enum(PAYMENT_METHODS).nullish(),
  variableAmount: z.boolean().default(false),
};

/**
 * Corpo de `POST /recurrences` e `/recurrences/preview`. Conta **ou** cartão; regra do dia
 * (exceto semanal, que usa o dia da semana da data inicial) **ou** partes.
 * @see RN 3
 */
export const recurrenceBodySchema = z
  .object(recurrenceFields)
  .refine((b) => Boolean(b.accountId) !== Boolean(b.cardId), {
    message: 'informe a conta ou o cartão (só um)',
    path: ['accountId'],
  })
  .refine((b) => b.frequency === 'weekly' || Boolean(b.dayRule) !== Boolean(b.parts?.length), {
    message: 'informe a regra do dia ou as partes (só um)',
    path: ['dayRule'],
  })
  .refine((b) => b.frequency !== 'weekly' || !b.parts?.length, {
    message: 'recorrência semanal não aceita partes',
    path: ['parts'],
  })
  .refine((b) => !b.endDate || b.endDate >= b.startDate, {
    message: 'o fim deve ser depois do início',
    path: ['endDate'],
  });
export type RecurrenceBody = z.input<typeof recurrenceBodySchema>;

/**
 * Corpo de `PATCH /recurrences/:id?from=YYYY-MM`. Mudar valor ou regra vale "a partir do
 * mês" `from` (padrão: o mês atual): encerra a recorrência antes dele e cria uma nova.
 * Descrição e categoria mudam na própria recorrência e nos previstos ainda não editados.
 */
export const updateRecurrenceBodySchema = z
  .object({
    description: nameSchema,
    categoryId: z.uuid().nullable(),
    amount: z.int().positive(),
    frequency: z.enum(RECURRENCE_FREQUENCIES),
    interval: z.int().min(1).max(120),
    dayRule: dayRuleSchema.nullable(),
    adjust: z.enum(BUSINESS_DAY_ADJUSTS),
    parts: z.array(recurrencePartSchema).min(2).max(6).nullable(),
    endDate: isoDateSchema.nullable(),
    variableAmount: z.boolean(),
  })
  .partial();
export type UpdateRecurrenceBody = z.infer<typeof updateRecurrenceBodySchema>;

export const recurrenceFromQuerySchema = z.object({
  from: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'use o formato AAAA-MM')
    .optional(),
});

export const recurrencePreviewQuerySchema = z.object({
  months: z.coerce.number().int().min(1).max(36).default(12),
});

export const occurrenceSchema = z.object({
  date: isoDateSchema,
  amount: z.int(),
  reference: z.string(),
  label: z.string().nullable(),
});
export type OccurrencePreview = z.infer<typeof occurrenceSchema>;

export const recurrenceSchema = z.object({
  id: z.uuid(),
  type: z.enum(['income', 'expense']),
  description: z.string(),
  amount: z.int(),
  frequency: z.enum(RECURRENCE_FREQUENCIES),
  interval: z.int(),
  dayRule: dayRuleSchema.nullable(),
  adjust: z.enum(BUSINESS_DAY_ADJUSTS),
  parts: z.array(recurrencePartSchema).nullable(),
  startDate: isoDateSchema,
  endDate: isoDateSchema.nullable(),
  accountId: z.uuid().nullable(),
  cardId: z.uuid().nullable(),
  categoryId: z.uuid().nullable(),
  paymentMethod: z.enum(PAYMENT_METHODS).nullable(),
  variableAmount: z.boolean(),
  generatedUntil: isoDateSchema.nullable(),
  /** Próximas ocorrências (até 3). */
  next: z.array(occurrenceSchema),
});
export type Recurrence = z.infer<typeof recurrenceSchema>;
