import { z } from 'zod';
import { isoDateSchema, nameSchema } from './common';

const targetAmountSchema = z.int().positive().max(9_000_000_000_00);

export const createGoalBodySchema = z.object({
  name: nameSchema,
  targetAmount: targetAmountSchema,
  targetDate: isoDateSchema.nullish(),
  /** Conta onde o dinheiro da meta fica: o guardado passa a ser o saldo dela. */
  accountId: z.uuid().nullish(),
  /** Já guardado à mão (só sem conta vinculada). */
  savedAmount: z.int().min(0).max(9_000_000_000_00).default(0),
});
export type CreateGoalBody = z.input<typeof createGoalBodySchema>;

export const updateGoalBodySchema = z
  .object({
    name: nameSchema,
    targetAmount: targetAmountSchema,
    targetDate: isoDateSchema.nullable(),
    accountId: z.uuid().nullable(),
    archived: z.boolean(),
  })
  .partial();
export type UpdateGoalBody = z.infer<typeof updateGoalBodySchema>;

/** Aporte (positivo) ou retirada (negativa) marcada à mão. */
export const goalDepositBodySchema = z.object({
  amount: z
    .int()
    .min(-9_000_000_000_00)
    .max(9_000_000_000_00)
    .refine((v) => v !== 0, 'informe um valor'),
});
export type GoalDepositBody = z.infer<typeof goalDepositBodySchema>;

export const goalSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  targetAmount: z.int(),
  targetDate: z.string().nullable(),
  accountId: z.uuid().nullable(),
  accountName: z.string().nullable(),
  archived: z.boolean(),
  saved: z.int(),
  remaining: z.int(),
  ratio: z.number(),
  monthsLeft: z.int().nullable(),
  suggestedMonthly: z.int().nullable(),
  status: z.enum(['done', 'on_track', 'overdue', 'no_date']),
});
export type Goal = z.infer<typeof goalSchema>;
