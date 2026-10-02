import {
  addMonths,
  endOfMonth,
  generateOccurrences,
  nationalHolidayDates,
  parseISODate,
  startOfMonth,
  type ISODate,
  type Occurrence,
  type RecurrenceRule,
} from '@finapp/core';
import { and, eq, gte, isNull, sql } from 'drizzle-orm';
import { recurrences, transactions, type RecurrencePartJson } from '../../db/schema';
import type { DbExecutor } from '../../db/seed';
import { badRequest } from '../../http/errors';
import { findAccount } from '../accounts/service';
import { ensureInvoice, findCard, invoiceMonthFor } from '../cards/service';

export type RecurrenceRow = typeof recurrences.$inferSelect;

type PartInput = {
  label?: string | undefined;
  amount?: number | undefined;
  percent?: number | undefined;
  dayRule: RecurrencePartJson['dayRule'];
  adjust?: 'none' | 'previous' | 'next' | undefined;
  monthOffset?: number | undefined;
};

/** Partes como gravadas (sem chaves `undefined`). */
export function normalizeParts(parts: readonly PartInput[] | null | undefined) {
  if (!parts) return null;
  return parts.map((p) => {
    const out: RecurrencePartJson = { dayRule: p.dayRule };
    if (p.label) out.label = p.label;
    if (p.amount !== undefined) out.amount = p.amount;
    if (p.percent !== undefined) out.percent = p.percent;
    if (p.adjust !== undefined) out.adjust = p.adjust;
    if (p.monthOffset !== undefined) out.monthOffset = p.monthOffset;
    return out;
  });
}

/** Janela de geração: os próximos 12 meses (RN 3). */
export const WINDOW_MONTHS = 12;

export function toRule(
  row: Pick<
    RecurrenceRow,
    'frequency' | 'interval' | 'dayRule' | 'adjust' | 'startDate' | 'endDate' | 'amount' | 'parts'
  >,
): RecurrenceRule {
  return {
    frequency: row.frequency,
    interval: row.interval,
    ...(row.dayRule ? { dayRule: row.dayRule } : {}),
    adjust: row.adjust,
    startDate: row.startDate,
    endDate: row.endDate,
    amount: row.amount,
    parts: row.parts ?? null,
  };
}

/** Ocorrências da regra entre `from` e `to` (feriados nacionais). 400 se a regra for inválida. */
export function occurrencesOf(rule: RecurrenceRule, from: ISODate, to: ISODate): Occurrence[] {
  if (from > to) return [];
  try {
    const holidays = nationalHolidayDates(parseISODate(from).year, parseISODate(to).year + 1);
    return generateOccurrences(rule, { from, to, holidays });
  } catch (err) {
    if (err instanceof RangeError) throw badRequest('invalid_recurrence', err.message);
    throw err;
  }
}

/** Primeiro dia que a geração considera: o início da regra ou o 1º dia do mês atual. */
export function windowStart(rule: RecurrenceRule, today: ISODate): ISODate {
  const monthStart = startOfMonth(today);
  return rule.startDate > monthStart ? rule.startDate : monthStart;
}

export const windowEnd = (today: ISODate): ISODate => endOfMonth(addMonths(today, WINDOW_MONTHS));

/** Identidade da ocorrência: `YYYY-MM#parte`, ou a data no semanal. */
export function occurrenceKey(rule: RecurrenceRule, occ: Occurrence): string {
  return rule.frequency === 'weekly' ? occ.date : `${occ.reference}#${occ.part ?? 0}`;
}

export function occurrenceDescription(row: Pick<RecurrenceRow, 'description'>, occ: Occurrence) {
  return occ.label ? `${row.description} (${occ.label})` : row.description;
}

/**
 * Gera (idempotente) os lançamentos previstos da recorrência na janela. Ocorrências que já
 * existem, mesmo excluídas pelo usuário, não são recriadas. No cartão, cada ocorrência vai
 * para a fatura da sua data.
 */
export async function materialize(
  db: DbExecutor,
  row: RecurrenceRow,
  today: ISODate,
  userId: string | null,
): Promise<number> {
  if (row.deletedAt) return 0;
  const rule = toRule(row);
  const to = windowEnd(today);
  const occurrences = occurrencesOf(rule, windowStart(rule, today), to);
  const card = row.cardId ? await findCard(db, row.spaceId, row.cardId) : null;
  const account = row.accountId ? await findAccount(db, row.spaceId, row.accountId) : null;
  let created = 0;
  for (const occ of occurrences) {
    // Antes do saldo inicial da conta, o valor já está no saldo inicial.
    if (account && occ.date < account.initialDate) continue;
    const invoiceId = card
      ? (await ensureInvoice(db, card, await invoiceMonthFor(db, card, occ.date), userId)).id
      : null;
    const settled = card ? occ.date <= today : false;
    const inserted = await db
      .insert(transactions)
      .values({
        spaceId: row.spaceId,
        createdBy: userId,
        type: row.type,
        status: settled ? 'settled' : 'planned',
        amount: occ.amount,
        date: occ.date,
        description: occurrenceDescription(row, occ),
        accountId: card ? null : row.accountId,
        cardId: card?.id ?? null,
        invoiceId,
        categoryId: row.categoryId,
        paymentMethod: card ? 'credit' : row.paymentMethod,
        recurrenceId: row.id,
        recurrenceKey: occurrenceKey(rule, occ),
        estimated: row.variableAmount,
        settledAt: settled ? new Date() : null,
      })
      .onConflictDoNothing()
      .returning({ id: transactions.id });
    created += inserted.length;
  }
  await db.update(recurrences).set({ generatedUntil: to }).where(eq(recurrences.id, row.id));
  return created;
}

/**
 * Apaga (exclusão lógica) os previstos ainda não editados da recorrência a partir de uma
 * chave (`YYYY-MM` ou data): o que já foi efetivado ou editado à mão fica. Com
 * `freeKeys`, libera as chaves desses previstos para a recorrência gerá-los de novo
 * (edição no lugar); o que o usuário já tinha excluído continua excluído.
 */
export async function removePlannedFrom(
  db: DbExecutor,
  recurrenceId: string,
  fromKey: string,
  { freeKeys = false }: { freeKeys?: boolean } = {},
) {
  await db
    .update(transactions)
    .set({ deletedAt: new Date(), ...(freeKeys ? { recurrenceKey: null } : {}) })
    .where(
      and(
        eq(transactions.recurrenceId, recurrenceId),
        eq(transactions.status, 'planned'),
        eq(transactions.detached, false),
        isNull(transactions.deletedAt),
        gte(transactions.recurrenceKey, fromKey),
      ),
    );
}

/** Mantém a janela de todas as recorrências ativas do espaço (usado também pelo job). */
export async function materializeSpace(db: DbExecutor, spaceId: string, today: ISODate) {
  const rows = await db
    .select()
    .from(recurrences)
    .where(
      and(
        eq(recurrences.spaceId, spaceId),
        isNull(recurrences.deletedAt),
        sql`(${recurrences.endDate} is null or ${recurrences.endDate} >= ${startOfMonth(today)})`,
      ),
    );
  let created = 0;
  for (const row of rows) created += await materialize(db, row, today, null);
  return created;
}
