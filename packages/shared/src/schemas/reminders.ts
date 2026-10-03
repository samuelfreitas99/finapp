import { z } from 'zod';
import { REMINDER_REPEATS } from '../enums';

export const reminderBodySchema = z.object({
  title: z.string().trim().min(1).max(200),
  notes: z.string().trim().max(2000).nullish(),
  /** Data e hora do aviso (ISO). Sem horário = item de checklist. */
  dueAt: z.iso.datetime({ offset: true }).nullish(),
  repeat: z.enum(REMINDER_REPEATS).default('none'),
});
export type ReminderBody = z.input<typeof reminderBodySchema>;

export const updateReminderBodySchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    notes: z.string().trim().max(2000).nullable(),
    dueAt: z.iso.datetime({ offset: true }).nullable(),
    repeat: z.enum(REMINDER_REPEATS),
    done: z.boolean(),
  })
  .partial();
export type UpdateReminderBody = z.infer<typeof updateReminderBodySchema>;

export const reminderSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  notes: z.string().nullable(),
  dueAt: z.string().nullable(),
  repeat: z.enum(REMINDER_REPEATS),
  done: z.boolean(),
  doneAt: z.string().nullable(),
});
export type Reminder = z.infer<typeof reminderSchema>;
