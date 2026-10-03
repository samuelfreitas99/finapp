import { yearMonthOf } from '@finapp/core';
import {
  budgetsQuerySchema,
  spaceItemParamsSchema,
  upsertBudgetBodySchema,
  type BudgetItem,
  type Budgets,
} from '@finapp/shared';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { budgets, categories } from '../../db/schema';
import { badRequest, notFound } from '../../http/errors';
import { currentUser } from '../../plugins/auth';
import { findCategory } from '../categories/routes';
import { spaceIdOf, type SpaceContext } from '../spaces/scope';
import { budgetStatuses } from './service';

/** Orçamentos por categoria de despesa. @see RN 8 */
export function budgetRoutes(app: FastifyInstance, { db, today }: SpaceContext) {
  app.get('/budgets', async (request): Promise<Budgets> => {
    const spaceId = spaceIdOf(request);
    const query = budgetsQuerySchema.parse(request.query);
    const month = query.month ?? yearMonthOf(today());
    const statuses = await budgetStatuses(db, spaceId, month);
    const cats = statuses.length
      ? await db
          .select()
          .from(categories)
          .where(
            inArray(
              categories.id,
              statuses.map((s) => s.budget.categoryId),
            ),
          )
      : [];
    const catOf = new Map(cats.map((c) => [c.id, c]));
    const items: BudgetItem[] = statuses
      .map(({ budget, progress }) => {
        const cat = catOf.get(budget.categoryId);
        return {
          id: budget.id,
          categoryId: budget.categoryId,
          categoryName: cat?.name ?? 'Categoria',
          categoryColor: cat?.color ?? null,
          categoryIcon: cat?.icon ?? null,
          month: budget.month,
          rollover: budget.rollover,
          limit: progress.limit,
          carry: progress.carry,
          available: progress.available,
          spent: progress.spent,
          remaining: progress.remaining,
          ratio: progress.ratio,
          level: progress.level,
        };
      })
      .sort((a, b) => b.ratio - a.ratio || a.categoryName.localeCompare(b.categoryName, 'pt-BR'));
    const available = items.reduce((s, i) => s + i.available, 0);
    const spent = items.reduce((s, i) => s + i.spent, 0);
    return { month, items, totals: { available, spent, remaining: available - spent } };
  });

  /** Cria ou atualiza o orçamento da categoria (geral ou de um mês). */
  app.put('/budgets', async (request, reply) => {
    const spaceId = spaceIdOf(request);
    const body = upsertBudgetBodySchema.parse(request.body ?? {});
    const category = await findCategory(db, spaceId, body.categoryId);
    if (category.isSystem || category.kind !== 'expense' || category.archivedAt) {
      throw badRequest('invalid_category', 'Use uma categoria de despesa ativa.');
    }
    if (category.parentId) {
      throw badRequest(
        'invalid_category',
        'O orçamento é da categoria principal (ela já inclui as subcategorias).',
      );
    }
    const month = body.month ?? null;
    const [existing] = await db
      .select()
      .from(budgets)
      .where(
        and(
          eq(budgets.spaceId, spaceId),
          eq(budgets.categoryId, body.categoryId),
          month === null ? isNull(budgets.month) : eq(budgets.month, month),
          isNull(budgets.deletedAt),
        ),
      );
    if (existing) {
      const [row] = await db
        .update(budgets)
        .set({ amount: body.amount, rollover: body.rollover })
        .where(eq(budgets.id, existing.id))
        .returning();
      return row;
    }
    const [row] = await db
      .insert(budgets)
      .values({
        spaceId,
        categoryId: body.categoryId,
        month,
        amount: body.amount,
        rollover: body.rollover,
        createdBy: currentUser(request).id,
      })
      .returning();
    return reply.code(201).send(row);
  });

  app.delete('/budgets/:id', async (request, reply) => {
    const { spaceId, id } = spaceItemParamsSchema.parse(request.params);
    const [row] = await db
      .update(budgets)
      .set({ deletedAt: sql`now()` })
      .where(and(eq(budgets.id, id), eq(budgets.spaceId, spaceId), isNull(budgets.deletedAt)))
      .returning({ id: budgets.id });
    if (!row) throw notFound('Orçamento');
    return reply.code(204).send();
  });
}
