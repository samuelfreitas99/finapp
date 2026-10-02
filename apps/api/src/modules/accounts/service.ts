import { accountBalance, type AccountBalance, type ISODate, type LedgerEntry } from '@finapp/core';
import { and, eq, inArray, isNull, lte, sql } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { accounts, transactions } from '../../db/schema';
import type { DbExecutor } from '../../db/seed';
import { badRequest, notFound } from '../../http/errors';

export type AccountRow = typeof accounts.$inferSelect;

/** Conta do espaço (não apagada), ou 404. */
export async function findAccount(db: DbExecutor, spaceId: string, id: string) {
  const [row] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, id), eq(accounts.spaceId, spaceId), isNull(accounts.deletedAt)));
  if (!row) throw notFound('Conta');
  return row;
}

/**
 * Conta de um lançamento que já está nela (edição): a data precisa ser a partir do saldo
 * inicial (o saldo inicial já inclui o que veio antes). Conta arquivada é aceita.
 */
export async function accountForEdit(db: DbExecutor, spaceId: string, id: string, date: ISODate) {
  const account = await findAccount(db, spaceId, id);
  if (date < account.initialDate) {
    throw badRequest(
      'date_before_initial_balance',
      `A data é anterior ao saldo inicial da conta "${account.name}" (${account.initialDate}).`,
    );
  }
  return account;
}

/** Conta que recebe um lançamento novo (ou movido para ela): além disso, não arquivada. */
export async function accountForEntry(db: DbExecutor, spaceId: string, id: string, date: ISODate) {
  const account = await accountForEdit(db, spaceId, id, date);
  if (account.archivedAt) {
    throw badRequest('account_archived', `A conta "${account.name}" está arquivada.`);
  }
  return account;
}

/**
 * Saldos (atual e previsto) das contas. O banco soma por conta/tipo/status/dia e o core
 * aplica a regra (RN 1).
 */
export async function balancesFor(
  db: Db,
  spaceId: string,
  rows: readonly AccountRow[],
  today: ISODate,
  forecastDate: ISODate,
): Promise<Map<string, AccountBalance>> {
  const result = new Map<string, AccountBalance>();
  if (rows.length === 0) return result;
  const upTo = forecastDate > today ? forecastDate : today;
  const sums = await db
    .select({
      accountId: transactions.accountId,
      type: transactions.type,
      status: transactions.status,
      date: transactions.date,
      amount: sql<string>`sum(${transactions.amount})`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.spaceId, spaceId),
        isNull(transactions.deletedAt),
        inArray(
          transactions.accountId,
          rows.map((r) => r.id),
        ),
        lte(transactions.date, upTo),
      ),
    )
    .groupBy(transactions.accountId, transactions.type, transactions.status, transactions.date);
  const ledger = new Map<string, LedgerEntry[]>();
  for (const s of sums) {
    const amount = Number(s.amount);
    // Ajustes de sinais opostos no mesmo dia podem somar zero: não mexem no saldo.
    if (!s.accountId || amount === 0) continue;
    const list = ledger.get(s.accountId) ?? [];
    list.push({ type: s.type, status: s.status, date: s.date, amount });
    ledger.set(s.accountId, list);
  }
  for (const r of rows) {
    result.set(r.id, accountBalance(r.initialBalance, ledger.get(r.id) ?? [], today, forecastDate));
  }
  return result;
}
