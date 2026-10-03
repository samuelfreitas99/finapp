import { z } from 'zod';
import { isoDateSchema } from './common';

export const COUPLE_SPLIT_MODES = ['equal', 'percent', 'amount', 'none'] as const;
export type CoupleSplitMode = (typeof COUPLE_SPLIT_MODES)[number];

/**
 * Corpo de `PUT /transactions/:id/split`. `none` remove a divisão. Nos outros modos,
 * `paidByUserId` é quem pagou com dinheiro próprio; `parts` vale para `percent` (soma 100)
 * e `amount` (soma o total); membros ausentes ficam com 0.
 */
export const coupleSplitBodySchema = z.object({
  mode: z.enum(COUPLE_SPLIT_MODES),
  paidByUserId: z.uuid().optional(),
  parts: z
    .array(
      z.object({
        userId: z.uuid(),
        percent: z.number().min(0).max(100).optional(),
        amount: z.int().min(0).optional(),
      }),
    )
    .optional(),
});
export type CoupleSplitBody = z.infer<typeof coupleSplitBodySchema>;

export const coupleSplitSchema = z.object({
  mode: z.enum(COUPLE_SPLIT_MODES),
  paidByUserId: z.uuid().nullable(),
  shares: z.array(z.object({ userId: z.uuid(), amount: z.int() })),
});
export type CoupleSplit = z.infer<typeof coupleSplitSchema>;

/** Padrão do espaço: aplicado como sugestão ao dividir uma despesa. */
export const splitSettingsBodySchema = z.object({
  mode: z.enum(['equal', 'percent', 'none']),
  /** Percentual de cada membro (soma 100) quando `mode` é `percent`. */
  percents: z.record(z.uuid(), z.number().min(0).max(100)).optional(),
});
export type SplitSettingsBody = z.infer<typeof splitSettingsBodySchema>;

export const splitSettingsSchema = z.object({
  mode: z.enum(['equal', 'percent', 'none']),
  percents: z.record(z.string(), z.number()),
});
export type SplitSettings = z.infer<typeof splitSettingsSchema>;

export const settlementBodySchema = z.object({
  /** Quem pagou (padrão: você). */
  fromUserId: z.uuid().optional(),
  toUserId: z.uuid(),
  amount: z.int().positive(),
  date: isoDateSchema.optional(),
  notes: z.string().trim().max(200).nullish(),
});
export type SettlementBody = z.infer<typeof settlementBodySchema>;

export const coupleBalanceSchema = z.object({
  members: z.array(z.object({ userId: z.uuid(), name: z.string(), balance: z.int() })),
  /** Pagamentos que zeram os saldos (já simplificados). */
  transfers: z.array(z.object({ fromUserId: z.uuid(), toUserId: z.uuid(), amount: z.int() })),
  settlements: z.array(
    z.object({
      id: z.uuid(),
      fromUserId: z.uuid(),
      toUserId: z.uuid(),
      amount: z.int(),
      date: z.string(),
      notes: z.string().nullable(),
    }),
  ),
  /** Despesas divididas cujo valor mudou depois da divisão (refazer). */
  staleCount: z.int(),
});
export type CoupleBalance = z.infer<typeof coupleBalanceSchema>;
