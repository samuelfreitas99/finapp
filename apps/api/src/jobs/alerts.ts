import {
  addDays,
  buildAlerts,
  endOfMonth,
  inQuietHours,
  REFERENCE_TIME_ZONE,
  type AlertSettings,
  type AlertType,
  type CardLimitSnapshot,
  type InvoiceSnapshot,
  type ISODate,
} from '@finapp/core';
import { and, eq, gte, inArray, isNull, lte } from 'drizzle-orm';
import type { Db } from '../db/client';
import {
  accounts,
  creditCards,
  notifications,
  spaceMembers,
  spaces,
  transactions,
} from '../db/schema';
import { balancesFor } from '../modules/accounts/service';
import { cardLedger } from '../modules/cards/service';
import type { PushSender } from '../modules/notifications/push';
import { settingsOf } from '../modules/notifications/routes';

/** Vencidos mais antigos que isto não geram alerta (evita enxurrada no primeiro uso). */
const OVERDUE_LOOKBACK_DAYS = 60;

/** Hora `HH:MM` no fuso de referência. */
export function clockIn(now: Date, timeZone = REFERENCE_TIME_ZONE): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(now);
}

/**
 * Gera as notificações do dia para todos os espaços e membros (idempotente pela chave).
 * Retorna quantas foram criadas.
 * @see RN 9
 */
export async function generateAlerts(db: Db, today: ISODate): Promise<number> {
  const spaceRows = await db.select({ id: spaces.id }).from(spaces).where(isNull(spaces.deletedAt));
  let created = 0;
  for (const { id: spaceId } of spaceRows) {
    const members = await db
      .select({ userId: spaceMembers.userId })
      .from(spaceMembers)
      .where(eq(spaceMembers.spaceId, spaceId));
    if (!members.length) continue;

    const accountRows = await db
      .select()
      .from(accounts)
      .where(
        and(eq(accounts.spaceId, spaceId), isNull(accounts.deletedAt), isNull(accounts.archivedAt)),
      );
    const planned = accountRows.length
      ? await db
          .select()
          .from(transactions)
          .where(
            and(
              eq(transactions.spaceId, spaceId),
              isNull(transactions.deletedAt),
              eq(transactions.status, 'planned'),
              inArray(transactions.type, ['income', 'expense']),
              inArray(
                transactions.accountId,
                accountRows.map((a) => a.id),
              ),
              gte(transactions.date, addDays(today, -OVERDUE_LOOKBACK_DAYS)),
              lte(transactions.date, addDays(today, 31)),
            ),
          )
      : [];

    const included = accountRows.filter((a) => a.includeInTotals);
    const forecast = included.length
      ? [...(await balancesFor(db, spaceId, included, today, endOfMonth(today))).values()].reduce(
          (s, b) => s + b.forecast,
          0,
        )
      : null;

    const cardRows = await db
      .select()
      .from(creditCards)
      .where(
        and(
          eq(creditCards.spaceId, spaceId),
          isNull(creditCards.deletedAt),
          isNull(creditCards.archivedAt),
        ),
      );
    const invoices: InvoiceSnapshot[] = [];
    const cards: CardLimitSnapshot[] = [];
    for (const card of cardRows) {
      const ledger = await cardLedger(db, card, today);
      cards.push({
        cardId: card.id,
        cardName: card.name,
        limit: card.limitAmount,
        available: ledger.availableLimit,
        currentMonth: ledger.currentMonth,
      });
      for (const r of ledger.rows) {
        if (!r.invoice) continue;
        invoices.push({
          id: r.invoice.id,
          cardId: card.id,
          cardName: card.name,
          referenceMonth: r.referenceMonth,
          closingDate: r.closingDate,
          dueDate: r.dueDate,
          total: r.total,
          remaining: r.remaining,
        });
      }
    }

    // Previsão do mês como no Planejamento: contas + o que falta pagar das faturas do mês.
    const monthEnd = endOfMonth(today);
    const invoiceDue = invoices
      .filter((i) => i.remaining > 0 && i.dueDate <= monthEnd)
      .reduce((s, i) => s + i.remaining, 0);
    const forecastWithInvoices = forecast === null ? null : forecast - invoiceDue;

    for (const { userId } of members) {
      const s = await settingsOf(db, userId);
      const settings: Partial<Record<AlertType, AlertSettings>> = {};
      for (const t of s.types)
        settings[t.type as AlertType] = { enabled: t.enabled, daysBefore: t.daysBefore };
      const alerts = buildAlerts({
        today,
        settings,
        planned: planned.map((p) => ({
          id: p.id,
          type: p.type === 'income' ? 'income' : 'expense',
          description: p.description,
          amount: p.amount,
          date: p.date,
        })),
        invoices,
        cards,
        forecastEndOfMonth: forecastWithInvoices,
      });
      if (!alerts.length) continue;
      const inserted = await db
        .insert(notifications)
        .values(
          alerts.map((a) => ({
            userId,
            spaceId,
            type: a.type,
            title: a.title,
            body: a.body,
            url: a.url,
            entityType: a.entityType,
            entityId: a.entityId,
            // Por usuário: o mesmo evento avisa cada membro uma vez.
            dedupeKey: `${userId}:${a.dedupeKey}`,
          })),
        )
        .onConflictDoNothing()
        .returning({ id: notifications.id });
      created += inserted.length;
    }
  }
  return created;
}

/**
 * Envia por push as notificações ainda não enviadas das últimas 24 h, respeitando o
 * horário de silêncio de cada usuário (fica para a próxima rodada).
 */
export async function sendPending(
  db: Db,
  push: PushSender | null,
  now: Date = new Date(),
): Promise<number> {
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const pending = await db
    .select()
    .from(notifications)
    .where(
      and(
        isNull(notifications.sentAt),
        isNull(notifications.readAt),
        gte(notifications.createdAt, since),
      ),
    );
  const clock = clockIn(now);
  const byUser = new Map<string, typeof pending>();
  for (const n of pending) byUser.set(n.userId, [...(byUser.get(n.userId) ?? []), n]);
  let sent = 0;
  for (const [userId, list] of byUser) {
    const s = await settingsOf(db, userId);
    if (inQuietHours(clock, s.quietStart, s.quietEnd)) continue;
    for (const n of list) {
      if (push) {
        sent += await push.send(userId, {
          title: n.title,
          body: n.body,
          url: n.url ?? '/',
          tag: n.type,
        });
      }
      await db.update(notifications).set({ sentAt: now }).where(eq(notifications.id, n.id));
    }
  }
  return sent;
}
