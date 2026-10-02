import { startOfMonth, type ISODate } from '@finapp/core';
import { and, gte, isNull, or } from 'drizzle-orm';
import type { Db } from '../db/client';
import { recurrences } from '../db/schema';
import { materializeSpace } from '../modules/recurrences/service';

/**
 * Mantém a janela de 12 meses de todas as recorrências ativas (de todos os espaços).
 * Idempotente: ocorrências já geradas (ou excluídas pelo usuário) não são recriadas.
 * @see RN 3, docs/arquitetura.md › Jobs
 */
export async function generateAllRecurrences(db: Db, today: ISODate): Promise<number> {
  const rows = await db
    .selectDistinct({ spaceId: recurrences.spaceId })
    .from(recurrences)
    .where(
      and(
        isNull(recurrences.deletedAt),
        or(isNull(recurrences.endDate), gte(recurrences.endDate, startOfMonth(today))),
      ),
    );
  let created = 0;
  for (const { spaceId } of rows) created += await materializeSpace(db, spaceId, today);
  return created;
}
