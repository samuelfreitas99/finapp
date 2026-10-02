import {
  createCategoryBodySchema,
  listCategoriesQuerySchema,
  spaceItemParamsSchema,
  updateCategoryBodySchema,
  type Category,
  type CategoryKind,
} from '@finapp/shared';
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { categories } from '../../db/schema';
import type { DbExecutor } from '../../db/seed';
import { badRequest, notFound } from '../../http/errors';
import { currentUser } from '../../plugins/auth';
import { spaceIdOf, type SpaceContext } from '../spaces/scope';

type CategoryRow = typeof categories.$inferSelect;

function toCategory(row: CategoryRow): Category {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    parentId: row.parentId,
    icon: row.icon,
    color: row.color,
    isSystem: row.isSystem,
    systemKey: row.systemKey,
    archived: row.archivedAt !== null,
  };
}

/** Categoria do espaço (não apagada), ou 404. */
export async function findCategory(db: DbExecutor, spaceId: string, id: string) {
  const [row] = await db
    .select()
    .from(categories)
    .where(
      and(eq(categories.id, id), eq(categories.spaceId, spaceId), isNull(categories.deletedAt)),
    );
  if (!row) throw notFound('Categoria');
  return row;
}

/** Categoria utilizável num lançamento do tipo informado (comum, ativa, mesmo tipo). */
export async function categoryForEntry(
  db: DbExecutor,
  spaceId: string,
  id: string,
  kind: CategoryKind,
) {
  const row = await findCategory(db, spaceId, id);
  if (row.isSystem) {
    throw badRequest('system_category', 'Categorias técnicas não podem ser escolhidas.');
  }
  if (row.archivedAt)
    throw badRequest('category_archived', `A categoria "${row.name}" está arquivada.`);
  if (row.kind !== kind) {
    throw badRequest(
      'category_kind_mismatch',
      kind === 'income' ? 'Use uma categoria de receita.' : 'Use uma categoria de despesa.',
    );
  }
  return row;
}

/** Id da categoria técnica do espaço (criada no seed). */
export async function systemCategoryId(
  db: DbExecutor,
  spaceId: string,
  key: NonNullable<CategoryRow['systemKey']>,
): Promise<string | null> {
  const [row] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(
      and(
        eq(categories.spaceId, spaceId),
        eq(categories.systemKey, key),
        isNull(categories.deletedAt),
      ),
    );
  return row?.id ?? null;
}

/** Categorias: CRUD, com subcategorias de um nível. @see docs/api.md › Cadastros */
export function categoryRoutes(app: FastifyInstance, { db }: SpaceContext) {
  /** Pai válido: do espaço, mesmo tipo, comum e sem pai (um nível só). */
  const assertParent = async (
    spaceId: string,
    parentId: string,
    kind: CategoryKind,
    selfId?: string,
  ) => {
    if (parentId === selfId)
      throw badRequest('invalid_parent', 'A categoria não pode ser pai dela mesma.');
    const parent = await findCategory(db, spaceId, parentId);
    if (parent.isSystem || parent.parentId || parent.kind !== kind) {
      throw badRequest(
        'invalid_parent',
        'A categoria pai deve ser do mesmo tipo e não pode ser uma subcategoria.',
      );
    }
    if (selfId) {
      const [child] = await db
        .select({ id: categories.id })
        .from(categories)
        .where(and(eq(categories.parentId, selfId), isNull(categories.deletedAt)))
        .limit(1);
      if (child) {
        throw badRequest(
          'invalid_parent',
          'Uma categoria com subcategorias não pode virar subcategoria.',
        );
      }
    }
  };

  app.get('/categories', async (request) => {
    const spaceId = spaceIdOf(request);
    const query = listCategoriesQuerySchema.parse(request.query);
    const rows = await db
      .select()
      .from(categories)
      .where(
        and(
          eq(categories.spaceId, spaceId),
          isNull(categories.deletedAt),
          query.kind ? eq(categories.kind, query.kind) : undefined,
          query.includeArchived ? undefined : isNull(categories.archivedAt),
          query.includeSystem ? undefined : eq(categories.isSystem, false),
        ),
      )
      .orderBy(asc(categories.kind), asc(categories.name));
    return { items: rows.map(toCategory) };
  });

  app.post('/categories', async (request, reply) => {
    const spaceId = spaceIdOf(request);
    const body = createCategoryBodySchema.parse(request.body ?? {});
    if (body.parentId) await assertParent(spaceId, body.parentId, body.kind);
    const [row] = await db
      .insert(categories)
      .values({
        spaceId,
        createdBy: currentUser(request).id,
        name: body.name,
        kind: body.kind,
        parentId: body.parentId ?? null,
        icon: body.icon ?? null,
        color: body.color ?? null,
      })
      .returning();
    if (!row) throw new Error('falha ao criar categoria');
    return reply.code(201).send(toCategory(row));
  });

  app.patch('/categories/:id', async (request) => {
    const { spaceId, id } = spaceItemParamsSchema.parse(request.params);
    const body = updateCategoryBodySchema.parse(request.body ?? {});
    const current = await findCategory(db, spaceId, id);
    if (current.isSystem && (body.parentId !== undefined || body.archived !== undefined)) {
      throw badRequest('system_category', 'Categorias técnicas só podem mudar nome, ícone e cor.');
    }
    if (body.parentId) await assertParent(spaceId, body.parentId, current.kind, id);
    const { archived, ...fields } = body;
    const [row] = await db
      .update(categories)
      .set({
        ...fields,
        ...(archived === undefined
          ? {}
          : { archivedAt: archived ? (current.archivedAt ?? new Date()) : null }),
      })
      .where(eq(categories.id, id))
      .returning();
    if (!row) throw new Error('falha ao atualizar categoria');
    return toCategory(row);
  });

  /**
   * Exclusão lógica. Os lançamentos mantêm a referência (aparecem como categoria
   * excluída) e as subcategorias sobem para o primeiro nível.
   */
  app.delete('/categories/:id', async (request, reply) => {
    const { spaceId, id } = spaceItemParamsSchema.parse(request.params);
    const current = await findCategory(db, spaceId, id);
    if (current.isSystem) {
      throw badRequest('system_category', 'Categorias técnicas não podem ser excluídas.');
    }
    await db.transaction(async (tx) => {
      await tx
        .update(categories)
        .set({ parentId: null })
        .where(and(eq(categories.parentId, id), eq(categories.spaceId, spaceId)));
      await tx.update(categories).set({ deletedAt: new Date() }).where(eq(categories.id, id));
    });
    return reply.code(204).send();
  });
}
