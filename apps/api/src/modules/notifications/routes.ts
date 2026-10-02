import {
  NOTIFICATION_TYPES,
  pushSubscriptionBodySchema,
  updateNotificationSettingsBodySchema,
  type NotificationDto,
  type NotificationSettings,
} from '@finapp/shared';
import { and, count, desc, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../../db/client';
import { notifications, notificationSettings, pushSubscriptions } from '../../db/schema';
import { ApiError, notFound } from '../../http/errors';
import { currentUser, requireUser } from '../../plugins/auth';
import type { PushSender } from './push';

export const DEFAULT_DAYS_BEFORE = 3;

/** Preferências do usuário com os padrões (ligado, 3 dias) para os tipos sem linha. */
export async function settingsOf(db: Db, userId: string): Promise<NotificationSettings> {
  const rows = await db
    .select()
    .from(notificationSettings)
    .where(eq(notificationSettings.userId, userId));
  const byType = new Map(rows.map((r) => [r.type, r]));
  return {
    quietStart: rows[0]?.quietStart ?? null,
    quietEnd: rows[0]?.quietEnd ?? null,
    types: NOTIFICATION_TYPES.map((type) => ({
      type,
      enabled: byType.get(type)?.enabled ?? true,
      daysBefore: byType.get(type)?.daysBefore ?? DEFAULT_DAYS_BEFORE,
    })),
  };
}

const toDto = (r: typeof notifications.$inferSelect): NotificationDto => ({
  id: r.id,
  type: r.type,
  title: r.title,
  body: r.body,
  url: r.url,
  spaceId: r.spaceId,
  readAt: r.readAt?.toISOString() ?? null,
  createdAt: r.createdAt.toISOString(),
});

/**
 * Web Push (chave VAPID, inscrições, teste), preferências de alerta e central de
 * notificações. Por usuário (não por espaço).
 * @see RN 9, docs/api.md › Notificações
 */
export function notificationRoutes(app: FastifyInstance, db: Db, push: PushSender | null) {
  const pushDisabled = () =>
    new ApiError(503, 'push_disabled', 'Notificações por push não estão configuradas no servidor.');

  app.get('/api/push/vapid-key', async () => {
    if (!push) throw pushDisabled();
    return { publicKey: push.publicKey };
  });

  app.post('/api/push/subscriptions', { preHandler: requireUser }, async (request, reply) => {
    const user = currentUser(request);
    const body = pushSubscriptionBodySchema.parse(request.body ?? {});
    const userAgent = String(request.headers['user-agent'] ?? '').slice(0, 300) || null;
    await db
      .insert(pushSubscriptions)
      .values({
        userId: user.id,
        endpoint: body.endpoint,
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
        userAgent,
      })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: { userId: user.id, p256dh: body.keys.p256dh, auth: body.keys.auth, userAgent },
      });
    return reply.code(201).send({ ok: true });
  });

  app.delete('/api/push/subscriptions', { preHandler: requireUser }, async (request, reply) => {
    const user = currentUser(request);
    const { endpoint } = z.object({ endpoint: z.string().min(1) }).parse(request.body ?? {});
    await db
      .delete(pushSubscriptions)
      .where(and(eq(pushSubscriptions.userId, user.id), eq(pushSubscriptions.endpoint, endpoint)));
    return reply.code(204).send();
  });

  /** Envia um push de teste para os aparelhos inscritos do usuário. */
  app.post('/api/push/test', { preHandler: requireUser }, async (request) => {
    if (!push) throw pushDisabled();
    const user = currentUser(request);
    const sent = await push.send(user.id, {
      title: 'FinApp',
      body: 'Notificações ligadas. Você vai ser avisado dos vencimentos por aqui.',
      url: '/',
      tag: 'test',
    });
    return { sent };
  });

  app.get('/api/notification-settings', { preHandler: requireUser }, async (request) =>
    settingsOf(db, currentUser(request).id),
  );

  app.patch('/api/notification-settings', { preHandler: requireUser }, async (request) => {
    const user = currentUser(request);
    const body = updateNotificationSettingsBodySchema.parse(request.body ?? {});
    const current = await settingsOf(db, user.id);
    const quietStart = body.quietStart !== undefined ? body.quietStart : current.quietStart;
    const quietEnd = body.quietEnd !== undefined ? body.quietEnd : current.quietEnd;
    const changes = new Map((body.types ?? []).map((t) => [t.type, t]));
    for (const t of current.types) {
      const c = changes.get(t.type);
      const row = {
        userId: user.id,
        type: t.type,
        enabled: c?.enabled ?? t.enabled,
        daysBefore: c?.daysBefore ?? t.daysBefore,
        quietStart,
        quietEnd,
      };
      await db
        .insert(notificationSettings)
        .values(row)
        .onConflictDoUpdate({
          target: [notificationSettings.userId, notificationSettings.type],
          set: { enabled: row.enabled, daysBefore: row.daysBefore, quietStart, quietEnd },
        });
    }
    return settingsOf(db, user.id);
  });

  app.get('/api/notifications', { preHandler: requireUser }, async (request) => {
    const user = currentUser(request);
    const [rows, [unread]] = await Promise.all([
      db
        .select()
        .from(notifications)
        .where(eq(notifications.userId, user.id))
        .orderBy(desc(notifications.createdAt))
        .limit(50),
      db
        .select({ n: count() })
        .from(notifications)
        .where(and(eq(notifications.userId, user.id), isNull(notifications.readAt))),
    ]);
    return { items: rows.map(toDto), unread: unread?.n ?? 0 };
  });

  app.post('/api/notifications/:id/read', { preHandler: requireUser }, async (request) => {
    const user = currentUser(request);
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const [row] = await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.id, id), eq(notifications.userId, user.id)))
      .returning();
    if (!row) throw notFound('Notificação');
    return toDto(row);
  });

  app.post('/api/notifications/read-all', { preHandler: requireUser }, async (request) => {
    const user = currentUser(request);
    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.userId, user.id), isNull(notifications.readAt)));
    return { ok: true };
  });
}
