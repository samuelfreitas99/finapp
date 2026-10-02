import { randomBytes } from 'node:crypto';
import { and, eq, gt, isNull, or, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { invites, spaceMembers, spaces, userSettings } from '../db/schema';

export type Invite = typeof invites.$inferSelect;

/** Código de convite legível (sem 0/O/1/I), ex.: `K7QP-M4XD`. */
export function generateInviteCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(8);
  const chars = [...bytes].map((b) => alphabet[b % alphabet.length]);
  return `${chars.slice(0, 4).join('')}-${chars.slice(4).join('')}`;
}

/** Normaliza o que o usuário digitou (maiúsculas, sem espaços). */
export function normalizeInviteCode(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, '');
}

/**
 * Reserva o convite de forma atômica (só um cadastro consegue usar cada código).
 * Retorna `null` se o código não existe, já foi usado, expirou ou é de outro e-mail.
 */
export async function claimInvite(db: Db, rawCode: string, email: string): Promise<Invite | null> {
  const code = normalizeInviteCode(rawCode);
  const [invite] = await db
    .update(invites)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(invites.code, code),
        isNull(invites.usedAt),
        or(isNull(invites.expiresAt), gt(invites.expiresAt, sql`now()`)),
        or(isNull(invites.email), eq(sql`lower(${invites.email})`, email.toLowerCase())),
      ),
    )
    .returning();
  return invite ?? null;
}

/**
 * Depois do cadastro: liga o convite ao usuário, cria o espaço pessoal, as
 * configurações e, se o convite for de um espaço compartilhado, adiciona como membro.
 * @see docs/arquitetura.md › Autenticação, ADR-007
 */
export async function onboardUser(
  db: Db,
  user: { id: string; name: string },
  inviteId: string | null,
) {
  await db.transaction(async (tx) => {
    let sharedSpaceId: string | null = null;
    if (inviteId) {
      const [invite] = await tx
        .update(invites)
        .set({ usedBy: user.id })
        .where(eq(invites.id, inviteId))
        .returning({ spaceId: invites.spaceId });
      sharedSpaceId = invite?.spaceId ?? null;
    }
    const [personal] = await tx
      .insert(spaces)
      .values({ name: 'Pessoal', type: 'personal', createdBy: user.id })
      .returning({ id: spaces.id });
    if (!personal) throw new Error('falha ao criar o espaço pessoal');
    await tx.insert(spaceMembers).values({ spaceId: personal.id, userId: user.id, role: 'owner' });
    if (sharedSpaceId) {
      await tx
        .insert(spaceMembers)
        .values({ spaceId: sharedSpaceId, userId: user.id, role: 'member' })
        .onConflictDoNothing();
    }
    await tx.insert(userSettings).values({ userId: user.id, activeSpaceId: personal.id });
  });
}
