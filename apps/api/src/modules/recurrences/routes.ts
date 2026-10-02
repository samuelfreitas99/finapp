import { addDays, addMonths, splitRecurrenceFrom, yearMonthOf } from '@finapp/core';
import {
  recurrenceBodySchema,
  recurrenceFromQuerySchema,
  recurrencePreviewQuerySchema,
  spaceItemParamsSchema,
  updateRecurrenceBodySchema,
  type Recurrence,
} from '@finapp/shared';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { recurrences, transactions } from '../../db/schema';
import type { DbExecutor } from '../../db/seed';
import { notFound } from '../../http/errors';
import { currentUser } from '../../plugins/auth';
import { accountForEntry } from '../accounts/service';
import { cardForEntry } from '../cards/service';
import { categoryForEntry } from '../categories/routes';
import { spaceIdOf, type SpaceContext } from '../spaces/scope';
import {
  materialize,
  normalizeParts,
  occurrenceDescription,
  occurrencesOf,
  removePlannedFrom,
  toRule,
  windowEnd,
  windowStart,
  type RecurrenceRow,
} from './service';

/** Campos que mudam o cronograma: valem "a partir do mês" informado. */
const SCHEDULE_FIELDS = ['amount', 'frequency', 'interval', 'dayRule', 'adjust', 'parts'] as const;

/**
 * Recorrências (receitas e despesas fixas, salário em partes): prévia, criação, edição
 * "a partir de" e encerramento. Os lançamentos previstos são gerados para 12 meses.
 * @see docs/api.md › Recorrências, RN 3
 */
export function recurrenceRoutes(app: FastifyInstance, { db, today }: SpaceContext) {
  const toRecurrence = (row: RecurrenceRow): Recurrence => {
    const t = today();
    const rule = toRule(row);
    const next = occurrencesOf(rule, t > row.startDate ? t : row.startDate, windowEnd(t))
      .slice(0, 3)
      .map((o) => ({
        date: o.date,
        amount: o.amount,
        reference: o.reference,
        label: o.label ?? null,
      }));
    return {
      id: row.id,
      type: row.type === 'income' ? 'income' : 'expense',
      description: row.description,
      amount: row.amount,
      frequency: row.frequency,
      interval: row.interval,
      dayRule: row.dayRule ?? null,
      adjust: row.adjust,
      parts: row.parts ?? null,
      startDate: row.startDate,
      endDate: row.endDate,
      accountId: row.accountId,
      cardId: row.cardId,
      categoryId: row.categoryId,
      paymentMethod: row.paymentMethod,
      variableAmount: row.variableAmount,
      generatedUntil: row.generatedUntil,
      next,
    };
  };

  const findRecurrence = async (tx: DbExecutor, spaceId: string, id: string) => {
    const [row] = await tx
      .select()
      .from(recurrences)
      .where(
        and(
          eq(recurrences.id, id),
          eq(recurrences.spaceId, spaceId),
          isNull(recurrences.deletedAt),
        ),
      );
    if (!row) throw notFound('Recorrência');
    return row;
  };

  /** Gera as ocorrências sem salvar (padrão: 12 meses a partir do início ou do mês atual). */
  app.post('/recurrences/preview', async (request) => {
    spaceIdOf(request);
    const body = recurrenceBodySchema.parse(request.body ?? {});
    const { months } = recurrencePreviewQuerySchema.parse(request.query);
    const rule = toRule({
      frequency: body.frequency,
      interval: body.interval,
      dayRule: body.dayRule ?? null,
      adjust: body.adjust,
      startDate: body.startDate,
      endDate: body.endDate ?? null,
      amount: body.amount,
      parts: normalizeParts(body.parts),
    });
    const from = windowStart(rule, today());
    const to = addDays(addMonths(from, months), -1);
    return {
      items: occurrencesOf(rule, from, to).map((o) => ({
        date: o.date,
        amount: o.amount,
        reference: o.reference,
        label: o.label ?? null,
      })),
    };
  });

  app.post('/recurrences', async (request, reply) => {
    const spaceId = spaceIdOf(request);
    const body = recurrenceBodySchema.parse(request.body ?? {});
    const userId = currentUser(request).id;
    const row = await db.transaction(async (tx) => {
      // A conta só recebe as ocorrências geradas (do mês atual em diante).
      if (body.accountId) {
        const t = today();
        await accountForEntry(tx, spaceId, body.accountId, body.startDate > t ? body.startDate : t);
      }
      if (body.cardId) await cardForEntry(tx, spaceId, body.cardId);
      if (body.categoryId) await categoryForEntry(tx, spaceId, body.categoryId, body.type);
      // Valida a regra antes de gravar.
      occurrencesOf(
        toRule({
          ...body,
          dayRule: body.dayRule ?? null,
          parts: normalizeParts(body.parts),
          endDate: body.endDate ?? null,
        }),
        body.startDate,
        body.startDate,
      );
      const [inserted] = await tx
        .insert(recurrences)
        .values({
          spaceId,
          createdBy: userId,
          type: body.type,
          description: body.description,
          amount: body.amount,
          frequency: body.frequency,
          interval: body.interval,
          dayRule: body.dayRule ?? null,
          adjust: body.adjust,
          parts: normalizeParts(body.parts),
          startDate: body.startDate,
          endDate: body.endDate ?? null,
          accountId: body.accountId ?? null,
          cardId: body.cardId ?? null,
          categoryId: body.categoryId ?? null,
          paymentMethod: body.cardId ? 'credit' : (body.paymentMethod ?? null),
          variableAmount: body.variableAmount,
        })
        .returning();
      if (!inserted) throw new Error('falha ao criar recorrência');
      await materialize(tx, inserted, today(), userId);
      return findRecurrence(tx, spaceId, inserted.id);
    });
    return reply.code(201).send(toRecurrence(row));
  });

  /** Ativas: não excluídas e sem fim antes do mês atual. */
  app.get('/recurrences', async (request) => {
    const spaceId = spaceIdOf(request);
    const monthStart = `${yearMonthOf(today())}-01`;
    const rows = await db
      .select()
      .from(recurrences)
      .where(and(eq(recurrences.spaceId, spaceId), isNull(recurrences.deletedAt)))
      .orderBy(desc(recurrences.createdAt));
    return {
      items: rows.filter((r) => !r.endDate || r.endDate >= monthStart).map(toRecurrence),
    };
  });

  app.get('/recurrences/:id', async (request) => {
    const { spaceId, id } = spaceItemParamsSchema.parse(request.params);
    return toRecurrence(await findRecurrence(db, spaceId, id));
  });

  /**
   * Editar. Valor/regra: "a partir do mês" `?from=YYYY-MM` (padrão: o atual). Se a
   * recorrência começa nesse mês ou depois, muda no lugar; senão, encerra a atual no mês
   * anterior e cria uma nova (RN 3). Previstos ainda não editados são refeitos; efetivados
   * e editados à mão ficam como estão.
   */
  app.patch('/recurrences/:id', async (request) => {
    const { spaceId, id } = spaceItemParamsSchema.parse(request.params);
    const body = updateRecurrenceBodySchema.parse(request.body ?? {});
    const query = recurrenceFromQuerySchema.parse(request.query);
    const userId = currentUser(request).id;
    const t = today();
    const result = await db.transaction(async (tx) => {
      const current = await findRecurrence(tx, spaceId, id);
      if (body.categoryId) {
        await categoryForEntry(
          tx,
          spaceId,
          body.categoryId,
          current.type === 'income' ? 'income' : 'expense',
        );
      }
      const scheduleChanged = SCHEDULE_FIELDS.some((k) => body[k] !== undefined);
      const fromMonth = query.from ?? yearMonthOf(t);
      const startMonth = yearMonthOf(current.startDate);

      if (scheduleChanged && fromMonth > startMonth) {
        const { previous, next } = splitRecurrenceFrom(toRule(current), fromMonth, {
          ...(body.amount !== undefined ? { amount: body.amount } : {}),
          ...(body.frequency !== undefined ? { frequency: body.frequency } : {}),
          ...(body.interval !== undefined ? { interval: body.interval } : {}),
          ...(body.dayRule ? { dayRule: body.dayRule } : {}),
          ...(body.adjust !== undefined ? { adjust: body.adjust } : {}),
          ...(body.parts !== undefined ? { parts: normalizeParts(body.parts) } : {}),
          ...(body.endDate !== undefined ? { endDate: body.endDate } : {}),
        });
        occurrencesOf(next, next.startDate, next.startDate);
        await tx
          .update(recurrences)
          .set({ endDate: previous.endDate ?? null })
          .where(eq(recurrences.id, current.id));
        await removePlannedFrom(tx, current.id, fromMonth);
        const [created] = await tx
          .insert(recurrences)
          .values({
            spaceId,
            createdBy: userId,
            type: current.type,
            description: body.description ?? current.description,
            amount: next.amount,
            frequency: next.frequency,
            interval: next.interval ?? 1,
            dayRule: next.dayRule ?? null,
            adjust: next.adjust ?? 'none',
            parts: normalizeParts(next.parts),
            startDate: next.startDate,
            endDate: next.endDate ?? null,
            accountId: current.accountId,
            cardId: current.cardId,
            categoryId: body.categoryId !== undefined ? body.categoryId : current.categoryId,
            paymentMethod: current.paymentMethod,
            variableAmount: body.variableAmount ?? current.variableAmount,
          })
          .returning();
        if (!created) throw new Error('falha ao criar a nova recorrência');
        await materialize(tx, created, t, userId);
        return findRecurrence(tx, spaceId, created.id);
      }

      const { parts, ...rest } = body;
      const [updated] = await tx
        .update(recurrences)
        .set({ ...rest, ...(parts !== undefined ? { parts: normalizeParts(parts) } : {}) })
        .where(eq(recurrences.id, current.id))
        .returning();
      if (!updated) throw new Error('falha ao atualizar recorrência');
      const rule = toRule(updated);
      occurrencesOf(rule, rule.startDate, rule.startDate);
      if (scheduleChanged || body.endDate !== undefined || body.variableAmount !== undefined) {
        await removePlannedFrom(tx, current.id, startMonth, { freeKeys: true });
        await materialize(tx, updated, t, userId);
      } else if (body.description !== undefined || body.categoryId !== undefined) {
        await syncMetadata(tx, updated);
      }
      return updated;
    });
    return toRecurrence(result);
  });

  /** Descrição/categoria nos previstos ainda não editados. */
  const syncMetadata = async (tx: DbExecutor, row: RecurrenceRow) => {
    const planned = await tx
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.recurrenceId, row.id),
          eq(transactions.status, 'planned'),
          eq(transactions.detached, false),
          isNull(transactions.deletedAt),
        ),
      );
    for (const p of planned) {
      const part = Number(p.recurrenceKey?.split('#')[1] ?? 0);
      const label = row.parts?.[part]?.label;
      await tx
        .update(transactions)
        .set({
          description: occurrenceDescription(row, {
            date: p.date,
            amount: p.amount,
            reference: '',
            ...(label ? { label } : {}),
          }),
          categoryId: row.categoryId,
        })
        .where(eq(transactions.id, p.id));
    }
  };

  /** Encerra: some da lista e apaga os previstos futuros ainda não editados. */
  app.delete('/recurrences/:id', async (request, reply) => {
    const { spaceId, id } = spaceItemParamsSchema.parse(request.params);
    const current = await findRecurrence(db, spaceId, id);
    await db.transaction(async (tx) => {
      await removePlannedFrom(tx, current.id, today());
      await tx
        .update(recurrences)
        .set({ deletedAt: new Date() })
        .where(eq(recurrences.id, current.id));
    });
    return reply.code(204).send();
  });

  /** Mantém a janela de 12 meses (o job diário chama o mesmo serviço). */
  app.post('/recurrences/generate', async (request) => {
    const spaceId = spaceIdOf(request);
    const rows = await db
      .select()
      .from(recurrences)
      .where(and(eq(recurrences.spaceId, spaceId), isNull(recurrences.deletedAt)));
    let created = 0;
    for (const r of rows) created += await materialize(db, r, today(), currentUser(request).id);
    return { created };
  });
}
