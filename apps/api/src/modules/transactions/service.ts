import { isoDateSchema, type Transaction } from '@finapp/shared';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../../db/client';
import { contacts, tags, transactions, transactionTags } from '../../db/schema';
import type { DbExecutor } from '../../db/seed';
import { badRequest, notFound } from '../../http/errors';

export type TransactionRow = typeof transactions.$inferSelect;

export function toTransaction(row: TransactionRow, tagIds: string[] = []): Transaction {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    amount: row.amount,
    date: row.date,
    description: row.description,
    notes: row.notes,
    accountId: row.accountId,
    cardId: row.cardId,
    invoiceId: row.invoiceId,
    installmentPlanId: row.installmentPlanId,
    installmentNumber: row.installmentNumber,
    categoryId: row.categoryId,
    paymentMethod: row.paymentMethod,
    pixCounterparty: row.pixCounterparty,
    contactId: row.contactId,
    transferId: row.transferId,
    tagIds,
    settledAt: row.settledAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Lançamento do espaço (não apagado), ou 404. */
export async function findTransaction(db: DbExecutor, spaceId: string, id: string) {
  const [row] = await db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.id, id),
        eq(transactions.spaceId, spaceId),
        isNull(transactions.deletedAt),
      ),
    );
  if (!row) throw notFound('Lançamento');
  return row;
}

/** As duas pontas de uma transferência (saída primeiro). */
export async function transferLegs(db: DbExecutor, spaceId: string, transferId: string) {
  const legs = await db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.transferId, transferId),
        eq(transactions.spaceId, spaceId),
        isNull(transactions.deletedAt),
      ),
    );
  const rank = (r: TransactionRow) => (r.type === 'transfer_out' ? 0 : 1);
  return legs.sort((a, b) => rank(a) - rank(b));
}

export async function assertContact(db: DbExecutor, spaceId: string, id: string) {
  const [row] = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(eq(contacts.id, id), eq(contacts.spaceId, spaceId), isNull(contacts.deletedAt)));
  if (!row) throw badRequest('invalid_contact', 'Contato não encontrado neste espaço.');
}

/** Substitui as tags do lançamento, conferindo que todas são do espaço. */
export async function setTags(
  db: DbExecutor,
  spaceId: string,
  transactionId: string,
  tagIds: readonly string[],
) {
  const unique = [...new Set(tagIds)];
  if (unique.length) {
    const found = await db
      .select({ id: tags.id })
      .from(tags)
      .where(and(inArray(tags.id, unique), eq(tags.spaceId, spaceId), isNull(tags.deletedAt)));
    if (found.length !== unique.length) {
      throw badRequest('invalid_tag', 'Alguma tag não existe neste espaço.');
    }
  }
  await db.delete(transactionTags).where(eq(transactionTags.transactionId, transactionId));
  if (unique.length) {
    await db.insert(transactionTags).values(unique.map((tagId) => ({ transactionId, tagId })));
  }
}

/** Tags de cada lançamento. */
export async function tagsOf(db: Db, ids: readonly string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (!ids.length) return map;
  const rows = await db
    .select()
    .from(transactionTags)
    .where(inArray(transactionTags.transactionId, [...ids]));
  for (const r of rows) map.set(r.transactionId, [...(map.get(r.transactionId) ?? []), r.tagId]);
  return map;
}

/** Cursor opaco `(date, id)` da listagem (ordem: data desc, id desc). */
export function encodeCursor(row: { date: string; id: string }): string {
  return Buffer.from(JSON.stringify([row.date, row.id])).toString('base64url');
}

export function decodeCursor(cursor: string): { date: string; id: string } {
  try {
    const [date, id] = JSON.parse(Buffer.from(cursor, 'base64url').toString()) as unknown[];
    if (isoDateSchema.safeParse(date).success && z.uuid().safeParse(id).success) {
      return { date: date as string, id: id as string };
    }
  } catch {
    // cai no erro abaixo
  }
  throw badRequest('invalid_cursor', 'Cursor inválido.');
}
