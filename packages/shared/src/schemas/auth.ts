import { z } from 'zod';
import { SPACE_ROLES, SPACE_TYPES } from '../enums';

/** Corpo de `POST /api/auth/sign-up/email` (campos do Better Auth + convite). */
export const signUpBodySchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.email(),
  password: z.string().min(8).max(128),
  inviteCode: z.string().trim().min(4).max(32),
});
export type SignUpBody = z.infer<typeof signUpBodySchema>;

export const spaceSummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  type: z.enum(SPACE_TYPES),
  role: z.enum(SPACE_ROLES),
});
export type SpaceSummary = z.infer<typeof spaceSummarySchema>;

/** Resposta de `GET /api/me`. */
export const meResponseSchema = z.object({
  user: z.object({ id: z.uuid(), name: z.string(), email: z.email() }),
  spaces: z.array(spaceSummarySchema),
  activeSpaceId: z.uuid().nullable(),
});
export type MeResponse = z.infer<typeof meResponseSchema>;

/** Corpo de `POST /api/invites`. */
export const createInviteBodySchema = z.object({
  /** Convite para entrar num espaço compartilhado do qual você é dono. */
  spaceId: z.uuid().optional(),
  /** Restringe o convite a um e-mail. */
  email: z.email().optional(),
  /** Validade em dias (padrão 7). */
  expiresInDays: z.int().min(1).max(90).optional(),
});
export type CreateInviteBody = z.infer<typeof createInviteBodySchema>;

export const inviteSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  spaceId: z.uuid().nullable(),
  email: z.string().nullable(),
  expiresAt: z.iso.datetime().nullable(),
  usedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type Invite = z.infer<typeof inviteSchema>;
