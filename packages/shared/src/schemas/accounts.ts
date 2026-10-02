import { z } from 'zod';
import { ACCOUNT_TYPES } from '../enums';
import { centsSchema, colorSchema, isoDateSchema, nameSchema, queryBooleanSchema } from './common';

/** Corpo de `POST /api/spaces/:spaceId/accounts`. */
export const createAccountBodySchema = z.object({
  name: nameSchema,
  type: z.enum(ACCOUNT_TYPES),
  /** Saldo na data inicial (pode ser negativo, ex.: cheque especial). */
  initialBalance: centsSchema.default(0),
  /** Data do saldo inicial; lançamentos antes dela não são aceitos. */
  initialDate: isoDateSchema,
  color: colorSchema.nullish(),
  icon: z.string().trim().min(1).max(50).nullish(),
  includeInTotals: z.boolean().default(true),
  /** No espaço compartilhado: membro dono da conta. */
  ownerUserId: z.uuid().nullish(),
});
export type CreateAccountBody = z.infer<typeof createAccountBodySchema>;

/** Corpo de `PATCH /api/spaces/:spaceId/accounts/:id`. `archived` arquiva/desarquiva. */
export const updateAccountBodySchema = z
  .object({
    name: nameSchema,
    type: z.enum(ACCOUNT_TYPES),
    initialBalance: centsSchema,
    initialDate: isoDateSchema,
    color: colorSchema.nullable(),
    icon: z.string().trim().min(1).max(50).nullable(),
    includeInTotals: z.boolean(),
    ownerUserId: z.uuid().nullable(),
    archived: z.boolean(),
  })
  .partial();
export type UpdateAccountBody = z.infer<typeof updateAccountBodySchema>;

export const listAccountsQuerySchema = z.object({
  includeArchived: queryBooleanSchema,
  /** Data do saldo previsto (padrão: último dia do mês corrente). */
  forecastDate: isoDateSchema.optional(),
});

export const accountBalanceQuerySchema = z.object({ date: isoDateSchema.optional() });

export const accountSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  type: z.enum(ACCOUNT_TYPES),
  initialBalance: z.int(),
  initialDate: isoDateSchema,
  color: z.string().nullable(),
  icon: z.string().nullable(),
  includeInTotals: z.boolean(),
  ownerUserId: z.uuid().nullable(),
  archived: z.boolean(),
  /** Saldo atual (efetivados até hoje). */
  balance: z.int(),
  /** Saldo previsto em `forecastDate`. */
  forecastBalance: z.int(),
  forecastDate: isoDateSchema,
});
export type Account = z.infer<typeof accountSchema>;

/** Resposta de `GET /accounts/:id/balance?date=`. */
export const accountBalanceSchema = z.object({
  accountId: z.uuid(),
  today: isoDateSchema,
  current: z.int(),
  date: isoDateSchema,
  forecast: z.int(),
});
export type AccountBalanceResponse = z.infer<typeof accountBalanceSchema>;
