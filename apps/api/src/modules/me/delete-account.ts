import { and, eq, inArray, ne } from 'drizzle-orm';
import type { Db } from '../../db/client';
import {
  invites,
  spaceMembers,
  spaces,
  splitExpensePostings,
  splitGroupLinks,
  splitGroups,
  splitParticipants,
} from '../../db/schema';
import { badRequest } from '../../http/errors';

/**
 * Apaga os dados de quem vai excluir a conta (LGPD): espaço pessoal e espaços compartilhados
 * dos quais é o único membro, com tudo dentro. Recusa se é dono de um espaço compartilhado
 * com outras pessoas (precisa removê-las antes) e não derruba o que é de outros: nos espaços
 * dos outros os lançamentos ficam sem autor; nos grupos de racha a pessoa vira só um nome.
 */
export async function deleteUserData(db: Db, userId: string): Promise<void> {
  const mine = await db
    .select({
      id: spaces.id,
      type: spaces.type,
      role: spaceMembers.role,
      name: spaces.name,
      deletedAt: spaces.deletedAt,
    })
    .from(spaceMembers)
    .innerJoin(spaces, eq(spaces.id, spaceMembers.spaceId))
    .where(eq(spaceMembers.userId, userId));

  const toDelete: string[] = [];
  for (const space of mine) {
    if (space.role !== 'owner') continue;
    // Espaço já excluído pelo dono: some de vez junto com a conta.
    if (space.type === 'shared' && !space.deletedAt) {
      const others = await db
        .select({ userId: spaceMembers.userId })
        .from(spaceMembers)
        .where(and(eq(spaceMembers.spaceId, space.id), ne(spaceMembers.userId, userId)));
      if (others.length > 0) {
        throw badRequest(
          'owns_shared_space',
          `Você é dono do espaço "${space.name}" e ele tem outros membros. Em Espaços e membros, passe a posse para outro membro ou exclua o espaço antes de excluir a conta.`,
        );
      }
    }
    toDelete.push(space.id);
  }

  await db.transaction(async (tx) => {
    // Ligações do racha com o espaço (apontam para lançamentos que vão sair).
    await tx.delete(splitExpensePostings).where(eq(splitExpensePostings.userId, userId));
    await tx.delete(splitGroupLinks).where(eq(splitGroupLinks.userId, userId));

    // Grupos de racha criados por esta pessoa: passam para outro participante com conta;
    // sem ninguém com conta, o grupo some.
    const groups = await tx.select().from(splitGroups).where(eq(splitGroups.createdBy, userId));
    for (const group of groups) {
      const [heir] = await tx
        .select({ userId: splitParticipants.userId })
        .from(splitParticipants)
        .where(and(eq(splitParticipants.groupId, group.id), ne(splitParticipants.userId, userId)));
      if (heir?.userId) {
        await tx
          .update(splitGroups)
          .set({ createdBy: heir.userId })
          .where(eq(splitGroups.id, group.id));
      } else {
        await tx.delete(splitGroups).where(eq(splitGroups.id, group.id));
      }
    }

    await tx.update(invites).set({ usedBy: null }).where(eq(invites.usedBy, userId));
    if (toDelete.length) await tx.delete(spaces).where(inArray(spaces.id, toDelete));
  });
}
