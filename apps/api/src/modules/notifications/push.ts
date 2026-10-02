import { eq, inArray } from 'drizzle-orm';
import webpush from 'web-push';
import type { PushConfig } from '../../config';
import type { Db } from '../../db/client';
import { pushSubscriptions } from '../../db/schema';

export interface PushPayload {
  title: string;
  body: string;
  /** Caminho no app aberto ao tocar. */
  url?: string;
  /** Agrupa/substitui notificações iguais no aparelho. */
  tag?: string;
}

/** Envio de Web Push; inscrições expiradas (404/410) são apagadas. */
export interface PushSender {
  publicKey: string;
  send: (userId: string, payload: PushPayload) => Promise<number>;
}

export function createPushSender(db: Db, config: PushConfig): PushSender {
  webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
  return {
    publicKey: config.publicKey,
    async send(userId, payload) {
      const subs = await db
        .select()
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.userId, userId));
      let sent = 0;
      const gone: string[] = [];
      for (const s of subs) {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            JSON.stringify(payload),
            { TTL: 60 * 60 * 24 },
          );
          sent++;
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) gone.push(s.id);
        }
      }
      if (gone.length)
        await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, gone));
      return sent;
    },
  };
}
