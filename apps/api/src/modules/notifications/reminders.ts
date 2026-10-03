import { nextReminderAt } from '@finapp/core';
import { reminderBodySchema, updateReminderBodySchema, type Reminder } from '@finapp/shared';
import { and, desc, eq, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../../db/client';
import { notifications, reminders } from '../../db/schema';
import { notFound } from '../../http/errors';
import { currentUser, requireUser } from '../../plugins/auth';

type ReminderRow = typeof reminders.$inferSelect;

const toDto = (r: ReminderRow): Reminder => ({
  id: r.id,
  title: r.title,
  notes: r.notes,
  dueAt: r.dueAt?.toISOString() ?? null,
  repeat: r.repeat,
  done: r.doneAt !== null,
  doneAt: r.doneAt?.toISOString() ?? null,
});

/** Lembretes e checklist (por usuário). */
export function reminderRoutes(app: FastifyInstance, db: Db) {
  const find = async (userId: string, id: string) => {
    const [row] = await db
      .select()
      .from(reminders)
      .where(and(eq(reminders.id, id), eq(reminders.userId, userId), isNull(reminders.deletedAt)));
    if (!row) throw notFound('Lembrete');
    return row;
  };

  app.get('/api/reminders', { preHandler: requireUser }, async (request) => {
    const user = currentUser(request);
    const rows = await db
      .select()
      .from(reminders)
      .where(
        and(
          eq(reminders.userId, user.id),
          isNull(reminders.deletedAt),
          // Concluídos aparecem por 7 dias.
          or(isNull(reminders.doneAt), sql`${reminders.doneAt} > now() - interval '7 days'`),
        ),
      )
      .orderBy(
        sql`${reminders.doneAt} asc nulls first`,
        sql`${reminders.dueAt} asc nulls last`,
        desc(reminders.createdAt),
      );
    return { items: rows.map(toDto) };
  });

  app.post('/api/reminders', { preHandler: requireUser }, async (request, reply) => {
    const body = reminderBodySchema.parse(request.body ?? {});
    const [row] = await db
      .insert(reminders)
      .values({
        userId: currentUser(request).id,
        title: body.title,
        notes: body.notes ?? null,
        dueAt: body.dueAt ? new Date(body.dueAt) : null,
        repeat: body.repeat,
      })
      .returning();
    if (!row) throw new Error('falha ao criar lembrete');
    return reply.code(201).send(toDto(row));
  });

  /** Editar; `done: true` conclui (com repetição, avança para o próximo horário). */
  app.patch('/api/reminders/:id', { preHandler: requireUser }, async (request) => {
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const body = updateReminderBodySchema.parse(request.body ?? {});
    const current = await find(currentUser(request).id, id);
    const repeat = body.repeat ?? current.repeat;
    const due =
      body.dueAt !== undefined ? (body.dueAt ? new Date(body.dueAt) : null) : current.dueAt;
    let set: Partial<typeof reminders.$inferInsert> = { dueAt: due, repeat };
    if (body.title !== undefined) set.title = body.title;
    if (body.notes !== undefined) set.notes = body.notes;
    const done = body.done;
    if (done === true) {
      const next = due ? nextReminderAt(due.toISOString(), repeat) : null;
      set = next ? { ...set, dueAt: new Date(next), doneAt: null } : { ...set, doneAt: new Date() };
    } else if (done === false) {
      set = { ...set, doneAt: null };
    }
    const [row] = await db.update(reminders).set(set).where(eq(reminders.id, id)).returning();
    if (!row) throw new Error('falha ao atualizar lembrete');
    return toDto(row);
  });

  app.delete('/api/reminders/:id', { preHandler: requireUser }, async (request, reply) => {
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    await find(currentUser(request).id, id);
    await db.update(reminders).set({ deletedAt: new Date() }).where(eq(reminders.id, id));
    return reply.code(204).send();
  });
}

/**
 * Cria a notificação dos lembretes que chegaram no horário (uma por `due_at`); o envio
 * por push vem em seguida (`sendPending`).
 */
export async function notifyDueReminders(db: Db, now: Date = new Date()): Promise<number> {
  const due = await db
    .select()
    .from(reminders)
    .where(
      and(
        isNull(reminders.deletedAt),
        isNull(reminders.doneAt),
        isNotNull(reminders.dueAt),
        lte(reminders.dueAt, now),
        or(isNull(reminders.notifiedFor), sql`${reminders.notifiedFor} <> ${reminders.dueAt}`),
      ),
    );
  let created = 0;
  for (const r of due) {
    const inserted = await db
      .insert(notifications)
      .values({
        userId: r.userId,
        type: 'reminder',
        title: r.title,
        body: r.notes ?? 'Lembrete',
        url: '/lembretes',
        entityType: 'reminder',
        entityId: r.id,
        dedupeKey: `${r.userId}:reminder:${r.id}:${r.dueAt?.toISOString()}`,
      })
      .onConflictDoNothing()
      .returning({ id: notifications.id });
    created += inserted.length;
    await db.update(reminders).set({ notifiedFor: r.dueAt }).where(eq(reminders.id, r.id));
  }
  return created;
}
