import { z } from 'zod';
import { NOTIFICATION_TYPES } from '../enums';

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'use HH:MM');

/** Corpo de `POST /api/push/subscriptions` (formato do `PushSubscription.toJSON()`). */
export const pushSubscriptionBodySchema = z.object({
  endpoint: z.url().max(2000),
  keys: z.object({ p256dh: z.string().min(1).max(500), auth: z.string().min(1).max(500) }),
});
export type PushSubscriptionBody = z.infer<typeof pushSubscriptionBodySchema>;

export const notificationSettingsSchema = z.object({
  quietStart: hhmm.nullable(),
  quietEnd: hhmm.nullable(),
  types: z.array(
    z.object({
      type: z.enum(NOTIFICATION_TYPES),
      enabled: z.boolean(),
      daysBefore: z.int().min(0).max(30),
    }),
  ),
});
export type NotificationSettings = z.infer<typeof notificationSettingsSchema>;

export const updateNotificationSettingsBodySchema = z
  .object({
    quietStart: hhmm.nullable(),
    quietEnd: hhmm.nullable(),
    types: z.array(
      z.object({
        type: z.enum(NOTIFICATION_TYPES),
        enabled: z.boolean().optional(),
        daysBefore: z.int().min(0).max(30).optional(),
      }),
    ),
  })
  .partial();
export type UpdateNotificationSettingsBody = z.infer<typeof updateNotificationSettingsBodySchema>;

export const notificationSchema = z.object({
  id: z.uuid(),
  type: z.enum(NOTIFICATION_TYPES),
  title: z.string(),
  body: z.string(),
  url: z.string().nullable(),
  spaceId: z.uuid().nullable(),
  readAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type NotificationDto = z.infer<typeof notificationSchema>;
