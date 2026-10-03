import { z } from 'zod';
import { isoDateSchema, nameSchema } from './common';

export const RACHA_MODES = ['equal', 'percent', 'amount', 'shares'] as const;
export type RachaMode = (typeof RACHA_MODES)[number];

export const createGroupBodySchema = z.object({
  name: nameSchema,
  /** Nomes de amigos sem conta para já colocar no grupo. */
  friends: z.array(nameSchema).max(30).optional(),
});
export type CreateGroupBody = z.infer<typeof createGroupBodySchema>;

export const updateGroupBodySchema = z
  .object({ name: nameSchema, archived: z.boolean() })
  .partial();
export type UpdateGroupBody = z.infer<typeof updateGroupBodySchema>;

export const addParticipantBodySchema = z.object({ name: nameSchema });

/** Entrar com o código; `participantId` assume um nome já cadastrado no grupo. */
export const joinGroupBodySchema = z.object({
  code: z.string().trim().min(4).max(40),
  participantId: z.uuid().optional(),
});
export type JoinGroupBody = z.infer<typeof joinGroupBodySchema>;

/**
 * Despesa do grupo. `payers` somam o valor; `shares` lista quem divide e, conforme o modo,
 * `percent` (soma 100), `amount` (soma o valor) ou `weight` (cotas inteiras).
 */
export const groupExpenseBodySchema = z.object({
  description: z.string().trim().min(1).max(200),
  amount: z.int().positive().max(9_000_000_000_00),
  date: isoDateSchema,
  mode: z.enum(RACHA_MODES),
  category: z.string().trim().max(60).nullish(),
  payers: z.array(z.object({ participantId: z.uuid(), amount: z.int().positive() })).min(1),
  shares: z
    .array(
      z.object({
        participantId: z.uuid(),
        percent: z.number().min(0).max(100).optional(),
        amount: z.int().min(0).optional(),
        weight: z.int().min(1).optional(),
      }),
    )
    .min(1),
});
export type GroupExpenseBody = z.infer<typeof groupExpenseBodySchema>;

export const groupSettlementBodySchema = z.object({
  fromParticipantId: z.uuid(),
  toParticipantId: z.uuid(),
  amount: z.int().positive(),
  date: isoDateSchema.optional(),
  method: z.string().trim().max(30).nullish(),
});
export type GroupSettlementBody = z.infer<typeof groupSettlementBodySchema>;

const participantSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  userId: z.uuid().nullable(),
  /** É você. */
  isMe: z.boolean(),
});
export type GroupParticipant = z.infer<typeof participantSchema>;

export const groupSummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  archived: z.boolean(),
  participantCount: z.int(),
  /** Seu saldo no grupo: positivo = você tem a receber. */
  myBalance: z.int(),
});
export type GroupSummary = z.infer<typeof groupSummarySchema>;

export const groupExpenseSchema = z.object({
  id: z.uuid(),
  description: z.string(),
  amount: z.int(),
  date: z.string(),
  mode: z.enum(RACHA_MODES),
  category: z.string().nullable(),
  payers: z.array(z.object({ participantId: z.uuid(), amount: z.int() })),
  shares: z.array(
    z.object({ participantId: z.uuid(), amount: z.int(), weight: z.int().nullable() }),
  ),
});
export type GroupExpense = z.infer<typeof groupExpenseSchema>;

export const groupBalancesSchema = z.object({
  balances: z.array(z.object({ participantId: z.uuid(), name: z.string(), balance: z.int() })),
  /** Pagamentos que zeram o grupo; sem simplificar, só o saldo de cada um. */
  transfers: z.array(
    z.object({ fromParticipantId: z.uuid(), toParticipantId: z.uuid(), amount: z.int() }),
  ),
});
export type GroupBalances = z.infer<typeof groupBalancesSchema>;

export const groupDetailSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  archived: z.boolean(),
  joinCode: z.string(),
  participants: z.array(participantSchema),
  expenses: z.array(groupExpenseSchema),
  settlements: z.array(
    z.object({
      id: z.uuid(),
      fromParticipantId: z.uuid(),
      toParticipantId: z.uuid(),
      amount: z.int(),
      date: z.string(),
      method: z.string().nullable(),
    }),
  ),
  balances: groupBalancesSchema,
});
export type GroupDetail = z.infer<typeof groupDetailSchema>;

export const groupBalancesQuerySchema = z.object({
  simplify: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .default(true),
});
