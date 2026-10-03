import { z } from 'zod';

const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'use o formato AAAA-MM');

export const budgetsQuerySchema = z.object({
  /** Mês `YYYY-MM` (padrão: o corrente). */
  month: monthSchema.optional(),
});

/** Corpo de `PUT /budgets`: cria ou atualiza o orçamento da categoria (e mês). */
export const upsertBudgetBodySchema = z.object({
  categoryId: z.uuid(),
  /** Nulo = vale para todo mês; com mês, sobrepõe o geral só naquele mês. */
  month: monthSchema.nullish(),
  amount: z.int().min(0).max(9_000_000_000_00),
  rollover: z.boolean().default(false),
});
export type UpsertBudgetBody = z.input<typeof upsertBudgetBodySchema>;

export const budgetItemSchema = z.object({
  id: z.uuid(),
  categoryId: z.uuid(),
  categoryName: z.string(),
  categoryColor: z.string().nullable(),
  categoryIcon: z.string().nullable(),
  /** Nulo = orçamento de todo mês. */
  month: z.string().nullable(),
  rollover: z.boolean(),
  limit: z.int(),
  carry: z.int(),
  available: z.int(),
  spent: z.int(),
  remaining: z.int(),
  ratio: z.number(),
  level: z.enum(['ok', 'warning', 'exceeded']),
});
export type BudgetItem = z.infer<typeof budgetItemSchema>;

/** Resposta de `GET /api/spaces/:spaceId/budgets?month=`. */
export const budgetsSchema = z.object({
  month: z.string(),
  items: z.array(budgetItemSchema),
  totals: z.object({ available: z.int(), spent: z.int(), remaining: z.int() }),
});
export type Budgets = z.infer<typeof budgetsSchema>;
