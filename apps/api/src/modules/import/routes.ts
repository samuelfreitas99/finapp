import {
  addDays,
  hasNearbyMatch,
  importKeys,
  matchCategoryRule,
  normalizeText,
  parseCSVStatement,
  parseOFX,
  suggestRulePattern,
} from '@finapp/core';
import {
  categoryRuleBodySchema,
  importCommitBodySchema,
  importPreviewBodySchema,
  spaceItemParamsSchema,
  type CategoryRule,
  type ImportPreview,
  type ImportResult,
  type ImportRow,
} from '@finapp/shared';
import { and, asc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { categories, categoryRules, transactions } from '../../db/schema';
import { badRequest, notFound } from '../../http/errors';
import { currentUser } from '../../plugins/auth';
import { findAccount } from '../accounts/service';
import { findCategory } from '../categories/routes';
import { spaceIdOf, type SpaceContext } from '../spaces/scope';

const BODY_LIMIT = 3 * 1024 * 1024;
const DUPLICATE_TOLERANCE_DAYS = 2;

/** Importação de extrato (OFX/CSV) com deduplicação e regras de categoria. */
export function importRoutes(app: FastifyInstance, { db }: SpaceContext) {
  const rulesOf = async (spaceId: string) =>
    db
      .select({
        id: categoryRules.id,
        pattern: categoryRules.pattern,
        categoryId: categoryRules.categoryId,
        categoryName: categories.name,
        categoryKind: categories.kind,
      })
      .from(categoryRules)
      .innerJoin(categories, eq(categories.id, categoryRules.categoryId))
      .where(
        and(
          eq(categoryRules.spaceId, spaceId),
          isNull(categoryRules.deletedAt),
          isNull(categories.deletedAt),
          isNull(categories.archivedAt),
        ),
      )
      .orderBy(asc(categoryRules.pattern));

  /** Lê o extrato e marca o que já existe; nada é gravado. */
  app.post(
    '/import/preview',
    { bodyLimit: BODY_LIMIT },
    async (request): Promise<ImportPreview> => {
      const spaceId = spaceIdOf(request);
      const body = importPreviewBodySchema.parse(request.body ?? {});
      const account = await findAccount(db, spaceId, body.accountId);
      const parsed =
        body.format === 'ofx'
          ? parseOFX(body.content)
          : parseCSVStatement(body.content, { invert: body.invert });
      if (parsed.error) throw badRequest('invalid_statement', parsed.error);

      const keys = importKeys(parsed.entries);
      const dates = parsed.entries.map((e) => e.date).sort();
      const from = dates[0] ?? '';
      const to = dates.at(-1) ?? '';
      const existing = await db
        .select({
          key: transactions.importKey,
          date: transactions.date,
          amount: transactions.amount,
          type: transactions.type,
        })
        .from(transactions)
        .where(
          and(
            eq(transactions.accountId, account.id),
            isNull(transactions.deletedAt),
            inArray(transactions.type, ['income', 'expense']),
            gte(transactions.date, from ? addDays(from, -DUPLICATE_TOLERANCE_DAYS) : ''),
            lte(transactions.date, to ? addDays(to, DUPLICATE_TOLERANCE_DAYS) : ''),
          ),
        );
      // Chaves já importadas, inclusive de lançamentos excluídos: o que foi apagado não volta.
      const knownKeys = new Set(
        (
          await db
            .select({ key: transactions.importKey })
            .from(transactions)
            .where(
              and(eq(transactions.accountId, account.id), inArray(transactions.importKey, keys)),
            )
        ).flatMap((r) => (r.key ? [r.key] : [])),
      );
      const signed = existing.map((e) => ({
        date: e.date,
        amount: e.type === 'income' ? e.amount : -e.amount,
      }));
      const rules = await rulesOf(spaceId);

      const rows: ImportRow[] = parsed.entries.map((e, i) => {
        const type = e.amount > 0 ? 'income' : 'expense';
        const key = keys[i] ?? '';
        const duplicate = knownKeys.has(key)
          ? 'exact'
          : hasNearbyMatch({ date: e.date, amount: e.amount }, signed, DUPLICATE_TOLERANCE_DAYS)
            ? 'possible'
            : null;
        const rule = matchCategoryRule(
          e.description,
          rules.filter((r) => r.categoryKind === type),
        );
        return {
          date: e.date,
          type,
          amount: Math.abs(e.amount),
          description: e.description,
          importKey: key,
          duplicate,
          categoryId: rule?.categoryId ?? null,
          beforeInitialDate: e.date < account.initialDate,
        };
      });
      const exact = rows.filter((r) => r.duplicate === 'exact').length;
      const possible = rows.filter((r) => r.duplicate === 'possible').length;
      return {
        rows,
        counts: {
          total: rows.length,
          exact,
          possible,
          ready: rows.filter((r) => !r.duplicate && !r.beforeInitialDate).length,
        },
      };
    },
  );

  /** Grava os itens escolhidos como lançamentos efetivados; repetidos são ignorados. */
  app.post('/import/commit', { bodyLimit: BODY_LIMIT }, async (request): Promise<ImportResult> => {
    const spaceId = spaceIdOf(request);
    const body = importCommitBodySchema.parse(request.body ?? {});
    const account = await findAccount(db, spaceId, body.accountId);
    if (account.archivedAt) {
      throw badRequest('account_archived', `A conta "${account.name}" está arquivada.`);
    }
    const userId = currentUser(request).id;

    const categoryIds = [
      ...new Set(body.items.flatMap((i) => (i.categoryId ? [i.categoryId] : []))),
    ];
    const kindOf = new Map<string, string>();
    for (const id of categoryIds) {
      const c = await findCategory(db, spaceId, id);
      if (c.isSystem || c.archivedAt) {
        throw badRequest('invalid_category', `A categoria "${c.name}" não pode ser usada.`);
      }
      kindOf.set(id, c.kind);
    }
    for (const item of body.items) {
      if (item.categoryId && kindOf.get(item.categoryId) !== item.type) {
        throw badRequest(
          'category_kind_mismatch',
          item.type === 'income'
            ? 'Use uma categoria de receita.'
            : 'Use uma categoria de despesa.',
        );
      }
    }

    const usable = body.items.filter((i) => i.date >= account.initialDate);
    let created = 0;
    const now = new Date();
    for (let start = 0; start < usable.length; start += 200) {
      const chunk = usable.slice(start, start + 200);
      const inserted = await db
        .insert(transactions)
        .values(
          chunk.map((i) => ({
            spaceId,
            type: i.type,
            status: 'settled' as const,
            amount: i.amount,
            date: i.date,
            description: i.description,
            categoryId: i.categoryId ?? null,
            accountId: account.id,
            importKey: i.importKey,
            settledAt: now,
            createdBy: userId,
          })),
        )
        .onConflictDoNothing()
        .returning({ id: transactions.id });
      created += inserted.length;
    }

    let rulesCreated = 0;
    for (const item of body.items) {
      if (!item.saveRule || !item.categoryId) continue;
      const pattern = suggestRulePattern(item.description);
      if (pattern.length < 2) continue;
      const rule = await db
        .insert(categoryRules)
        .values({ spaceId, pattern, categoryId: item.categoryId, createdBy: userId })
        .onConflictDoNothing()
        .returning({ id: categoryRules.id });
      rulesCreated += rule.length;
    }
    return { created, skipped: body.items.length - created, rulesCreated };
  });

  app.get('/category-rules', async (request) => {
    const rows = await rulesOf(spaceIdOf(request));
    const items: CategoryRule[] = rows.map((r) => ({
      id: r.id,
      pattern: r.pattern,
      categoryId: r.categoryId,
      categoryName: r.categoryName,
    }));
    return { items };
  });

  app.post('/category-rules', async (request, reply) => {
    const spaceId = spaceIdOf(request);
    const body = categoryRuleBodySchema.parse(request.body ?? {});
    const category = await findCategory(db, spaceId, body.categoryId);
    if (category.isSystem || category.archivedAt) {
      throw badRequest('invalid_category', 'Escolha uma categoria comum e ativa.');
    }
    const pattern = normalizeText(body.pattern);
    const [row] = await db
      .insert(categoryRules)
      .values({ spaceId, pattern, categoryId: category.id, createdBy: currentUser(request).id })
      .onConflictDoUpdate({
        target: [categoryRules.spaceId, categoryRules.pattern],
        targetWhere: isNull(categoryRules.deletedAt),
        set: { categoryId: category.id },
      })
      .returning();
    if (!row) throw new Error('falha ao salvar regra');
    return reply.code(201).send({
      id: row.id,
      pattern: row.pattern,
      categoryId: row.categoryId,
      categoryName: category.name,
    });
  });

  app.delete('/category-rules/:id', async (request, reply) => {
    const { spaceId, id } = spaceItemParamsSchema.parse(request.params);
    const [row] = await db
      .update(categoryRules)
      .set({ deletedAt: sql`now()` })
      .where(
        and(
          eq(categoryRules.id, id),
          eq(categoryRules.spaceId, spaceId),
          isNull(categoryRules.deletedAt),
        ),
      )
      .returning({ id: categoryRules.id });
    if (!row) throw notFound('Regra');
    return reply.code(204).send();
  });
}
