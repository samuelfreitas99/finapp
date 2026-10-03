import { z } from 'zod';
import { isoDateSchema } from './common';
import { transactionSchema } from './transactions';

export const dashboardQuerySchema = z.object({
  /** Mês `YYYY-MM` (padrão: o corrente). */
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'use o formato AAAA-MM')
    .optional(),
});

const flowSchema = z.object({ settled: z.int(), planned: z.int() });

/** Resposta de `GET /api/spaces/:spaceId/dashboard`. */
export const dashboardSchema = z.object({
  today: isoDateSchema,
  month: z.string(),
  /** Saldo atual somado das contas ativas marcadas para somar nos totais. */
  balance: z.int(),
  /** Saldo previsto no último dia do mês (mesmas contas). */
  forecastBalance: z.int(),
  forecastDate: isoDateSchema,
  /** Receitas e despesas do mês (sem transferências e ajustes). */
  income: flowSchema,
  expense: flowSchema,
  /** Previstos vencidos e dos próximos 7 dias (até 10), por data. */
  upcoming: z.array(transactionSchema),
  overdueCount: z.int(),
  hasAccounts: z.boolean(),
  /** Algum extrato ou fatura já foi importado no espaço (primeiros passos). */
  hasImports: z.boolean(),
});
export type Dashboard = z.infer<typeof dashboardSchema>;
