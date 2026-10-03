import {
  addDays,
  importKeys,
  isInvoicePaymentLine,
  matchCategoryRule,
  normalizeText,
  parseCSVStatement,
  parseOFX,
  reconcileStatement,
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
import { categories, categoryRules, invoices, transactions } from '../../db/schema';
import { badRequest, notFound } from '../../http/errors';
import { currentUser } from '../../plugins/auth';
import { findAccount } from '../accounts/service';
import { cardForEntry, ensureInvoice } from '../cards/service';
import { findCategory } from '../categories/routes';
import { recordInstallmentPayment } from '../debts/service';
import { spaceIdOf, type SpaceContext } from '../spaces/scope';

const BODY_LIMIT = 3 * 1024 * 1024;
/** Janela de busca de lançamentos existentes (o previsto pode estar até 10 dias longe). */
const MATCH_WINDOW_DAYS = 10;

/** Importação de extrato (OFX/CSV) com deduplicação e regras de categoria. */
export function importRoutes(app: FastifyInstance, { db, today }: SpaceContext) {
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

  /** Conta do extrato, ou cartão + fatura do mês (a fatura pode ainda não existir). */
  const resolveTarget = async (
    spaceId: string,
    body: {
      accountId?: string | undefined;
      cardId?: string | undefined;
      invoiceMonth?: string | undefined;
    },
  ) => {
    if (body.cardId) {
      const card = await cardForEntry(db, spaceId, body.cardId);
      const month = body.invoiceMonth as string;
      const [invoice] = await db
        .select()
        .from(invoices)
        .where(and(eq(invoices.cardId, card.id), eq(invoices.referenceMonth, month)));
      return { kind: 'card' as const, card, month, invoice: invoice ?? null };
    }
    const account = await findAccount(db, spaceId, body.accountId as string);
    return { kind: 'account' as const, account };
  };

  /** Lê o extrato e marca o que já existe; nada é gravado. */
  app.post(
    '/import/preview',
    { bodyLimit: BODY_LIMIT },
    async (request): Promise<ImportPreview> => {
      const spaceId = spaceIdOf(request);
      const body = importPreviewBodySchema.parse(request.body ?? {});
      const target = await resolveTarget(spaceId, body);
      const card = target.kind === 'card';
      const parsed =
        body.format === 'ofx'
          ? parseOFX(body.content)
          : parseCSVStatement(body.content, { invert: body.invert });
      if (parsed.error) throw badRequest('invalid_statement', parsed.error);

      const keys = importKeys(parsed.entries);
      const dates = parsed.entries.map((e) => e.date).sort();
      const from = dates[0] ?? '';
      const to = dates.at(-1) ?? '';
      const where =
        target.kind === 'account'
          ? and(
              eq(transactions.accountId, target.account.id),
              gte(transactions.date, from ? addDays(from, -MATCH_WINDOW_DAYS) : ''),
              lte(transactions.date, to ? addDays(to, MATCH_WINDOW_DAYS) : ''),
            )
          : target.invoice
            ? eq(transactions.invoiceId, target.invoice.id)
            : null;
      const existing = !where
        ? []
        : await db
            .select({
              id: transactions.id,
              key: transactions.importKey,
              date: transactions.date,
              amount: transactions.amount,
              type: transactions.type,
              status: transactions.status,
              estimated: transactions.estimated,
              debtInstallmentId: transactions.debtInstallmentId,
              installmentPlanId: transactions.installmentPlanId,
              description: transactions.description,
            })
            .from(transactions)
            .where(
              and(
                where,
                isNull(transactions.deletedAt),
                inArray(transactions.type, ['income', 'expense']),
              ),
            );
      // Chaves já importadas, inclusive de lançamentos excluídos: o que foi apagado não volta.
      const knownKeys = new Set(
        (
          await db
            .select({ key: transactions.importKey })
            .from(transactions)
            .where(
              and(
                target.kind === 'account'
                  ? eq(transactions.accountId, target.account.id)
                  : eq(transactions.cardId, target.card.id),
                inArray(transactions.importKey, keys),
              ),
            )
        ).flatMap((r) => (r.key ? [r.key] : [])),
      );
      const byId = new Map(existing.map((e) => [e.id, e]));
      // Conciliação: só itens novos (não importados antes) procuram o lançamento existente.
      const matches = reconcileStatement(
        // Valor 0 nunca casa: já importado, ou pagamento da fatura anterior.
        parsed.entries.map((e, i) =>
          knownKeys.has(keys[i] ?? '') || (card && isInvoicePaymentLine(e.description, e.amount))
            ? { date: e.date, amount: 0 }
            : e,
        ),
        existing
          .filter((e) => e.status === 'planned' || e.status === 'settled')
          .map((e) => ({
            id: e.id,
            date: e.date,
            amount: e.type === 'income' ? e.amount : -e.amount,
            status: e.status as 'planned' | 'settled',
            // Parcela de dívida ou carnê pode vir corrigida, com juros ou desconto.
            estimated: e.estimated || Boolean(e.debtInstallmentId || e.installmentPlanId),
            imported: Boolean(e.key),
          })),
        // Na fatura, só os itens dela entram e a data pode ser a da compra original.
        card ? { plannedDays: Infinity, settledDays: Infinity } : {},
      );
      const rules = await rulesOf(spaceId);

      const rows: ImportRow[] = parsed.entries.map((e, i) => {
        const type = e.amount > 0 ? 'income' : 'expense';
        const key = keys[i] ?? '';
        const found = knownKeys.has(key) ? null : matches[i];
        const duplicate = knownKeys.has(key)
          ? 'exact'
          : found?.kind === 'possible'
            ? 'possible'
            : null;
        const matched = found && found.kind !== 'possible' ? byId.get(found.id) : undefined;
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
          beforeInitialDate: target.kind === 'account' && e.date < target.account.initialDate,
          invoicePayment: card && isInvoicePaymentLine(e.description, e.amount),
          match:
            matched && found && found.kind !== 'possible'
              ? {
                  id: matched.id,
                  kind: found.kind,
                  description: matched.description,
                  date: matched.date,
                  amount: matched.amount,
                }
              : null,
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
          ready: rows.filter((r) => !r.duplicate && !r.beforeInitialDate && !r.invoicePayment)
            .length,
          matched: rows.filter((r) => r.match && !r.beforeInitialDate).length,
        },
      };
    },
  );

  /** Grava os itens escolhidos como lançamentos efetivados; repetidos são ignorados. */
  app.post('/import/commit', { bodyLimit: BODY_LIMIT }, async (request): Promise<ImportResult> => {
    const spaceId = spaceIdOf(request);
    const body = importCommitBodySchema.parse(request.body ?? {});
    const target = await resolveTarget(spaceId, body);
    if (target.kind === 'account' && target.account.archivedAt) {
      throw badRequest('account_archived', `A conta "${target.account.name}" está arquivada.`);
    }
    const userId = currentUser(request).id;
    const invoiceId =
      target.kind === 'card'
        ? (await ensureInvoice(db, target.card, target.month, userId)).id
        : null;

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

    const usable = body.items.filter((i) =>
      target.kind === 'account'
        ? i.date >= target.account.initialDate
        : !isInvoicePaymentLine(i.description, i.type === 'income' ? i.amount : -i.amount),
    );
    const now = new Date();
    const t = today();

    // Itens que são um lançamento existente: confirma o previsto ou liga o feito à mão.
    let confirmed = 0;
    let linked = 0;
    for (const item of usable.filter((i) => i.matchId)) {
      await db.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(transactions)
          .where(
            and(
              eq(transactions.id, item.matchId as string),
              eq(transactions.spaceId, spaceId),
              target.kind === 'account'
                ? eq(transactions.accountId, target.account.id)
                : eq(transactions.invoiceId, invoiceId as string),
              eq(transactions.type, item.type),
              isNull(transactions.deletedAt),
            ),
          );
        if (!row) return;
        if (row.status === 'planned') {
          await tx
            .update(transactions)
            .set({
              status: 'settled',
              settledAt: now,
              estimated: false,
              amount: item.amount,
              date: item.date,
              importKey: item.importKey,
              ...(row.categoryId ? {} : { categoryId: item.categoryId ?? null }),
            })
            .where(eq(transactions.id, row.id));
          if (row.debtInstallmentId) {
            await recordInstallmentPayment(tx, {
              installmentId: row.debtInstallmentId,
              amount: item.amount,
              date: item.date,
              transactionId: row.id,
              today: t,
              userId,
            });
          }
          confirmed++;
        } else if (row.status === 'settled' && !row.importKey) {
          await tx
            .update(transactions)
            .set({ importKey: item.importKey })
            .where(eq(transactions.id, row.id));
          linked++;
        }
      });
    }

    const toCreate = usable.filter((i) => !i.matchId);
    let created = 0;
    for (let start = 0; start < toCreate.length; start += 200) {
      const chunk = toCreate.slice(start, start + 200);
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
            // Cartão: despesa é compra e receita é estorno, todos na fatura escolhida.
            ...(target.kind === 'account'
              ? { accountId: target.account.id }
              : { cardId: target.card.id, invoiceId, paymentMethod: 'credit' as const }),
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
    return {
      created,
      confirmed,
      linked,
      skipped: body.items.length - created - confirmed - linked,
      rulesCreated,
    };
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
