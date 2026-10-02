import { z } from 'zod';

/** Quantia em centavos (inteiro seguro). */
export const centsSchema = z.int();

/** Valor positivo em centavos. */
export const positiveCentsSchema = z.int().positive();

function isCalendarDate(value: string): boolean {
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  const date = new Date(0);
  date.setUTCFullYear(y, m - 1, d);
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** Data de calendário `YYYY-MM-DD` existente (sem fuso). */
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'use o formato AAAA-MM-DD')
  .refine(isCalendarDate, 'data inexistente');

/** Cor `#rrggbb`. */
export const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'cor no formato #rrggbb');

/** Texto curto obrigatório (nome, descrição). */
export const nameSchema = z.string().trim().min(1).max(120);

/** `?cursor=&limit=` das listas paginadas. */
export const paginationQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/** Parâmetro de rota `:spaceId`. */
export const spaceParamsSchema = z.object({ spaceId: z.uuid() });
export const spaceItemParamsSchema = z.object({ spaceId: z.uuid(), id: z.uuid() });

/** `?flag=true|false` em query string. */
export const queryBooleanSchema = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true')
  .optional();
