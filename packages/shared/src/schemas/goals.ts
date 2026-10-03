import { z } from 'zod';
import { isoDateSchema, nameSchema } from './common';

const targetAmountSchema = z.int().positive().max(9_000_000_000_00);

export const createGoalBodySchema = z.object({
  name: nameSchema,
  targetAmount: targetAmountSchema,
  targetDate: isoDateSchema.nullish(),
  /** Conta onde o dinheiro da meta fica: o guardado passa a ser o saldo dela. */
  accountId: z.uuid().nullish(),
  /** Quanto já está guardado para a meta (vira o primeiro aporte). */
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

/** Aporte (positivo) ou retirada (negativa) no cofrinho da meta. */
export const goalDepositBodySchema = z.object({
  date: isoDateSchema.optional(),
  note: z.string().trim().max(120).nullish(),
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
  /** Saldo atual da conta vinculada e quanto das metas dela já está reservado. */
  accountBalance: z.int().nullable(),
  reservedInAccount: z.int().nullable(),
  archived: z.boolean(),
  saved: z.int(),
  remaining: z.int(),
  ratio: z.number(),
  monthsLeft: z.int().nullable(),
  suggestedMonthly: z.int().nullable(),
  status: z.enum(['done', 'on_track', 'overdue', 'no_date']),
});
export type Goal = z.infer<typeof goalSchema>;

export const goalDepositSchema = z.object({
  id: z.uuid(),
  amount: z.int(),
  date: z.string(),
  note: z.string().nullable(),
});
export type GoalDeposit = z.infer<typeof goalDepositSchema>;
