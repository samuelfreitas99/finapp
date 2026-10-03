import { z } from 'zod';
import { SPACE_ROLES } from '../enums';
import { nameSchema } from './common';

/** Corpo de `POST /api/spaces`: cria um espaço compartilhado e torna você o dono. */
export const createSpaceBodySchema = z.object({ name: nameSchema });
export type CreateSpaceBody = z.infer<typeof createSpaceBodySchema>;

export const updateSpaceBodySchema = z.object({ name: nameSchema });
export type UpdateSpaceBody = z.infer<typeof updateSpaceBodySchema>;

export const spaceMemberSchema = z.object({
  userId: z.uuid(),
  name: z.string(),
  email: z.string(),
  role: z.enum(SPACE_ROLES),
  joinedAt: z.string(),
});
export type SpaceMember = z.infer<typeof spaceMemberSchema>;

/** Corpo de `POST /api/invites/accept`: entra num espaço compartilhado com o código. */
export const acceptInviteBodySchema = z.object({ code: z.string().trim().min(4).max(40) });
export type AcceptInviteBody = z.infer<typeof acceptInviteBodySchema>;

/** Corpo de `PUT /api/me/active-space`. */
export const activeSpaceBodySchema = z.object({ spaceId: z.uuid() });
export type ActiveSpaceBody = z.infer<typeof activeSpaceBodySchema>;

export const consolidatedQuerySchema = z.object({
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'use o formato AAAA-MM')
    .optional(),
});

/** Visão de todos os espaços do usuário (pessoal + compartilhados). */
export const consolidatedSchema = z.object({
  month: z.string(),
  spaces: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      type: z.enum(['personal', 'shared']),
      balance: z.int(),
      forecastBalance: z.int(),
      income: z.int(),
      expense: z.int(),
    }),
  ),
  totals: z.object({
    balance: z.int(),
    forecastBalance: z.int(),
    income: z.int(),
    expense: z.int(),
  }),
});
export type Consolidated = z.infer<typeof consolidatedSchema>;
