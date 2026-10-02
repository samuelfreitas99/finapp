import { z } from 'zod';

export const projectionQuerySchema = z.object({
  months: z.coerce.number().int().min(1).max(36).default(12),
});

export const projectionMonthSchema = z.object({
  month: z.string(),
  openingBalance: z.int(),
  income: z.int(),
  fixedExpenses: z.int(),
  invoices: z.int(),
  /** Parcelas pagas por conta (carnês e, na Fase 5, dívidas). */
  debts: z.int(),
  otherExpenses: z.int(),
  /** Faturas + parcelas + fixas. */
  committed: z.int(),
  /** Receitas − comprometido. */
  free: z.int(),
  closingBalance: z.int(),
  negative: z.boolean(),
});
export type ProjectionMonthDto = z.infer<typeof projectionMonthSchema>;

/** Resposta de `GET /api/spaces/:spaceId/projection?months=12`. @see RN 7 */
export const projectionSchema = z.object({
  today: z.string(),
  startingBalance: z.int(),
  months: z.array(projectionMonthSchema),
});
export type Projection = z.infer<typeof projectionSchema>;
