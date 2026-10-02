import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { spaceMembers, spaces } from '../../db/schema';

/**
 * Papel do usuário no espaço, ou `null` se não for membro (ou o espaço foi apagado).
 * Toda rota com `spaceId` deve passar por aqui antes de tocar nos dados.
 */
export async function spaceRole(db: Db, userId: string, spaceId: string) {
  const [row] = await db
    .select({ role: spaceMembers.role })
    .from(spaceMembers)
    .innerJoin(spaces, eq(spaces.id, spaceMembers.spaceId))
    .where(
      and(
        eq(spaceMembers.spaceId, spaceId),
        eq(spaceMembers.userId, userId),
        isNull(spaces.deletedAt),
      ),
    )
    .limit(1);
  return row?.role ?? null;
}

/** Espaços do usuário (pessoal primeiro). */
export async function userSpaces(db: Db, userId: string) {
  return db
    .select({ id: spaces.id, name: spaces.name, type: spaces.type, role: spaceMembers.role })
    .from(spaceMembers)
    .innerJoin(spaces, eq(spaces.id, spaceMembers.spaceId))
    .where(and(eq(spaceMembers.userId, userId), isNull(spaces.deletedAt)))
    .orderBy(spaces.type, spaces.createdAt);
}
