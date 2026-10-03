import { z } from 'zod';

const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'use o formato AAAA-MM');

export const byCategoryQuerySchema = z.object({
  /** Primeiro e último mês (`YYYY-MM`); padrão: o mês corrente. */
  from: monthSchema.optional(),
  to: monthSchema.optional(),
  kind: z.enum(['expense', 'income']).default('expense'),
});

const breakdownItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string().nullable(),
  amount: z.int(),
  share: z.number(),
});

export const byCategorySchema = z.object({
  from: z.string(),
  to: z.string(),
  kind: z.enum(['expense', 'income']),
  total: z.int(),
  items: z.array(breakdownItemSchema),
});
export type ByCategoryReport = z.infer<typeof byCategorySchema>;

export const monthlyQuerySchema = z.object({
  /** Quantos meses até o corrente (padrão 12). */
  months: z.coerce.number().int().min(1).max(36).default(12),
});

export const monthlySchema = z.object({
  items: z.array(
    z.object({
      month: z.string(),
      income: z.int(),
      expense: z.int(),
      balance: z.int(),
      savingsRate: z.number().nullable(),
    }),
  ),
  totals: z.object({
    income: z.int(),
    expense: z.int(),
    balance: z.int(),
    savingsRate: z.number().nullable(),
  }),
});
export type MonthlyReport = z.infer<typeof monthlySchema>;

const lineSchema = z.object({ label: z.string(), amount: z.int() });

export const netWorthSchema = z.object({
  assets: z.int(),
  liabilities: z.int(),
  net: z.int(),
  assetLines: z.array(lineSchema),
  liabilityLines: z.array(lineSchema),
});
export type NetWorthReport = z.infer<typeof netWorthSchema>;

export const exportQuerySchema = z.object({
  format: z.enum(['csv', 'xlsx', 'json']).default('csv'),
});

export const auditQuerySchema = z.object({
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  /** Filtra por entidade (`transactions`, `accounts`...). */
  entity: z.string().max(40).optional(),
});

export const auditItemSchema = z.object({
  id: z.uuid(),
  at: z.string(),
  userName: z.string().nullable(),
  entityType: z.string(),
  entityId: z.uuid().nullable(),
  action: z.string(),
  after: z.record(z.string(), z.unknown()).nullable(),
});
export type AuditItem = z.infer<typeof auditItemSchema>;
