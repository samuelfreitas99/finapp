import { addYearMonths, bestPurchaseDay, compareDates, invoiceDates } from '@finapp/core';
import {
  cardMonthParamsSchema,
  cardPaymentParamsSchema,
  createCardBodySchema,
  listCardsQuerySchema,
  listInvoicesQuerySchema,
  payInvoiceBodySchema,
  spaceItemParamsSchema,
  updateCardBodySchema,
  updateInvoiceBodySchema,
  type Card,
  type InvoiceDetail,
} from '@finapp/shared';
import { and, asc, desc, eq, gte, inArray, isNull, lte } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { creditCards, invoicePayments, invoices, transactions } from '../../db/schema';
import type { DbExecutor } from '../../db/seed';
import { badRequest, conflict, notFound } from '../../http/errors';
import { currentUser } from '../../plugins/auth';
import { accountForEntry, findAccount } from '../accounts/service';
import { systemCategoryId } from '../categories/routes';
import { spaceIdOf, type SpaceContext } from '../spaces/scope';
import { tagsOf, toTransaction } from '../transactions/service';
import {
  cardConfig,
  cardLedger,
  ensureInvoice,
  findCard,
  invoiceMonthFor,
  toInvoiceSummary,
  type CardRow,
} from './service';

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const monthName = (ym: string) => `${MONTHS[Number(ym.slice(5)) - 1]}/${ym.slice(0, 4)}`;

/**
 * Cartões, faturas (por mês de vencimento) e pagamentos de fatura.
 * @see docs/api.md › Faturas, RN 4
 */
export function cardRoutes(app: FastifyInstance, { db, today }: SpaceContext) {
  const toCard = async (card: CardRow): Promise<Card> => {
    const ledger = await cardLedger(db, card, today());
    const current = ledger.rows.find((r) => r.referenceMonth === ledger.currentMonth);
    if (!current) throw new Error('fatura atual não calculada');
    return {
      id: card.id,
      name: card.name,
      brand: card.brand,
      limitAmount: card.limitAmount,
      closingDay: card.closingDay,
      dueDay: card.dueDay,
      closingDayGoesToNext: card.closingDayGoesToNext,
      paymentAccountId: card.paymentAccountId,
      color: card.color,
      archived: card.archivedAt !== null,
      availableLimit: ledger.availableLimit,
      bestPurchaseDay: bestPurchaseDay(cardConfig(card)),
      currentInvoice: toInvoiceSummary(current),
    };
  };

  const assertPaymentAccount = async (spaceId: string, id: string | null | undefined) => {
    if (id) await findAccount(db, spaceId, id);
  };

  app.get('/cards', async (request) => {
    const spaceId = spaceIdOf(request);
    const query = listCardsQuerySchema.parse(request.query);
    const rows = await db
      .select()
      .from(creditCards)
      .where(
        and(
          eq(creditCards.spaceId, spaceId),
          isNull(creditCards.deletedAt),
          query.includeArchived ? undefined : isNull(creditCards.archivedAt),
        ),
      )
      .orderBy(asc(creditCards.createdAt));
    return { items: await Promise.all(rows.map(toCard)) };
  });

  app.get('/cards/:id', async (request) => {
    const { spaceId, id } = spaceItemParamsSchema.parse(request.params);
    return toCard(await findCard(db, spaceId, id));
  });

  app.get('/cards/:id/limit', async (request) => {
    const { spaceId, id } = spaceItemParamsSchema.parse(request.params);
    const card = await findCard(db, spaceId, id);
    const ledger = await cardLedger(db, card, today());
    return {
      limitAmount: card.limitAmount,
      availableLimit: ledger.availableLimit,
      used: card.limitAmount - ledger.availableLimit,
    };
  });

  app.post('/cards', async (request, reply) => {
    const spaceId = spaceIdOf(request);
    const body = createCardBodySchema.parse(request.body ?? {});
    await assertPaymentAccount(spaceId, body.paymentAccountId);
    const [row] = await db
      .insert(creditCards)
      .values({
        spaceId,
        createdBy: currentUser(request).id,
        name: body.name,
        brand: body.brand ?? null,
        limitAmount: body.limitAmount,
        closingDay: body.closingDay,
        dueDay: body.dueDay,
        closingDayGoesToNext: body.closingDayGoesToNext,
        paymentAccountId: body.paymentAccountId ?? null,
        color: body.color ?? null,
      })
      .returning();
    if (!row) throw new Error('falha ao criar cartão');
    return reply.code(201).send(await toCard(row));
  });

  /**
   * Mudar fechamento/vencimento recalcula as datas das faturas ainda abertas sem
   * override (as fechadas ficam como o banco cobrou).
   */
  app.patch('/cards/:id', async (request) => {
    const { spaceId, id } = spaceItemParamsSchema.parse(request.params);
    const body = updateCardBodySchema.parse(request.body ?? {});
    const current = await findCard(db, spaceId, id);
    if (body.paymentAccountId !== undefined)
      await assertPaymentAccount(spaceId, body.paymentAccountId);
    const { archived, ...fields } = body;
    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(creditCards)
        .set({
          ...fields,
          ...(archived === undefined
            ? {}
            : { archivedAt: archived ? (current.archivedAt ?? new Date()) : null }),
        })
        .where(eq(creditCards.id, id))
        .returning();
      if (!row) throw new Error('falha ao atualizar cartão');
      const datesChanged = row.closingDay !== current.closingDay || row.dueDay !== current.dueDay;
      if (datesChanged) {
        const open = await tx
          .select()
          .from(invoices)
          .where(
            and(
              eq(invoices.cardId, id),
              isNull(invoices.deletedAt),
              gte(invoices.closingDate, today()),
            ),
          );
        for (const inv of open) {
          const dates = invoiceDates(cardConfig(row), inv.referenceMonth, () => ({
            closingDate: inv.closingDateOverride,
            dueDate: inv.dueDateOverride,
          }));
          await tx
            .update(invoices)
            .set({ closingDate: dates.closingDate, dueDate: dates.dueDate })
            .where(eq(invoices.id, inv.id));
        }
      }
      return row;
    });
    return toCard(updated);
  });

  app.delete('/cards/:id', async (request, reply) => {
    const { spaceId, id } = spaceItemParamsSchema.parse(request.params);
    await findCard(db, spaceId, id);
    const [used] = await db
      .select({ id: transactions.id })
      .from(transactions)
      .where(and(eq(transactions.cardId, id), isNull(transactions.deletedAt)))
      .limit(1);
    if (used) {
      throw conflict(
        'card_has_transactions',
        'O cartão tem lançamentos: arquive em vez de excluir.',
      );
    }
    await db.update(creditCards).set({ deletedAt: new Date() }).where(eq(creditCards.id, id));
    return reply.code(204).send();
  });

  /** Faturas do cartão mês a mês (padrão: dos últimos 6 meses até o mês seguinte ao atual). */
  app.get('/cards/:id/invoices', async (request) => {
    const { spaceId, id } = spaceItemParamsSchema.parse(request.params);
    const query = listInvoicesQuerySchema.parse(request.query);
    const card = await findCard(db, spaceId, id);
    const ledger = await cardLedger(db, card, today(), { to: query.to });
    const from = query.from ?? addYearMonths(ledger.currentMonth, -5);
    const to = query.to ?? addYearMonths(ledger.currentMonth, 1);
    return {
      currentMonth: ledger.currentMonth,
      items: ledger.rows
        .filter((r) => r.referenceMonth >= from && r.referenceMonth <= to)
        .reverse()
        .map(toInvoiceSummary),
    };
  });

  const invoiceDetail = async (card: CardRow, month: string): Promise<InvoiceDetail> => {
    const ledger = await cardLedger(db, card, today(), { to: month });
    const row = ledger.rows.find((r) => r.referenceMonth === month);
    if (!row) throw notFound('Fatura');
    const entries = row.invoice
      ? await db
          .select()
          .from(transactions)
          .where(and(eq(transactions.invoiceId, row.invoice.id), isNull(transactions.deletedAt)))
          .orderBy(desc(transactions.date), desc(transactions.id))
      : [];
    const payments = row.invoice
      ? await db
          .select()
          .from(invoicePayments)
          .where(
            and(eq(invoicePayments.invoiceId, row.invoice.id), isNull(invoicePayments.deletedAt)),
          )
          .orderBy(asc(invoicePayments.date))
      : [];
    const tagMap = await tagsOf(
      db,
      entries.map((e) => e.id),
    );
    return {
      ...toInvoiceSummary(row),
      cardId: card.id,
      entries: entries.map((e) => toTransaction(e, tagMap.get(e.id) ?? [])),
      payments: payments.map((p) => ({
        id: p.id,
        accountId: p.accountId,
        amount: p.amount,
        date: p.date,
        transactionId: p.transactionId,
      })),
    };
  };

  app.get('/cards/:id/invoices/:month', async (request) => {
    const { spaceId, id, month } = cardMonthParamsSchema.parse(request.params);
    return invoiceDetail(await findCard(db, spaceId, id), month);
  });

  /**
   * Datas que o banco mudou neste mês. Compras avulsas (não parceladas) em faturas ainda
   * abertas são reposicionadas pela nova data de fechamento.
   */
  app.patch('/cards/:id/invoices/:month', async (request) => {
    const { spaceId, id, month } = cardMonthParamsSchema.parse(request.params);
    const body = updateInvoiceBodySchema.parse(request.body ?? {});
    const card = await findCard(db, spaceId, id);
    const userId = currentUser(request).id;
    await db.transaction(async (tx) => {
      const inv = await ensureInvoice(tx, card, month, userId);
      const closingOverride =
        body.closingDateOverride !== undefined ? body.closingDateOverride : inv.closingDateOverride;
      const dueOverride =
        body.dueDateOverride !== undefined ? body.dueDateOverride : inv.dueDateOverride;
      const dates = invoiceDates(cardConfig(card), month, () => ({
        closingDate: closingOverride,
        dueDate: dueOverride,
      }));
      if (compareDates(dates.closingDate, dates.dueDate) > 0) {
        throw badRequest('invalid_invoice_dates', 'O fechamento precisa ser antes do vencimento.');
      }
      await tx
        .update(invoices)
        .set({
          closingDateOverride: closingOverride,
          dueDateOverride: dueOverride,
          closingDate: dates.closingDate,
          dueDate: dates.dueDate,
        })
        .where(eq(invoices.id, inv.id));
      await reassignLooseItems(tx, card, month, userId);
    });
    return invoiceDetail(card, month);
  });

  /**
   * Reposiciona compras avulsas das faturas vizinhas (mês −1 a +1) que ainda não têm
   * pagamento: a data de fechamento corrigida decide a fatura de cada uma.
   */
  const reassignLooseItems = async (
    tx: DbExecutor,
    card: CardRow,
    month: string,
    userId: string,
  ) => {
    const around = await tx
      .select()
      .from(invoices)
      .where(
        and(
          eq(invoices.cardId, card.id),
          isNull(invoices.deletedAt),
          gte(invoices.referenceMonth, addYearMonths(month, -1)),
          lte(invoices.referenceMonth, addYearMonths(month, 1)),
        ),
      );
    const withPayments = new Set(
      around.length
        ? (
            await tx
              .select({ invoiceId: invoicePayments.invoiceId })
              .from(invoicePayments)
              .where(
                and(
                  inArray(
                    invoicePayments.invoiceId,
                    around.map((n) => n.id),
                  ),
                  isNull(invoicePayments.deletedAt),
                ),
              )
          ).map((p) => p.invoiceId)
        : [],
    );
    const neighbors = around.filter((n) => !withPayments.has(n.id));
    if (!neighbors.length) return;
    const items = await tx
      .select()
      .from(transactions)
      .where(
        and(
          inArray(
            transactions.invoiceId,
            neighbors.map((n) => n.id),
          ),
          isNull(transactions.deletedAt),
          isNull(transactions.installmentPlanId),
        ),
      );
    for (const item of items) {
      const target = await invoiceMonthFor(tx, card, item.date);
      const targetInvoice = await ensureInvoice(tx, card, target, userId);
      if (targetInvoice.id !== item.invoiceId) {
        await tx
          .update(transactions)
          .set({ invoiceId: targetInvoice.id })
          .where(eq(transactions.id, item.id));
      }
    }
  };

  /**
   * Pagar fatura (total ou parcial): despesa na conta com a categoria técnica "Pagamento
   * de fatura" + registro do pagamento. Padrões: conta do cartão, o que falta, hoje.
   */
  app.post('/cards/:id/invoices/:month/payments', async (request, reply) => {
    const { spaceId, id, month } = cardMonthParamsSchema.parse(request.params);
    const body = payInvoiceBodySchema.parse(request.body ?? {});
    const card = await findCard(db, spaceId, id);
    const t = today();
    const date = body.date ?? t;
    if (compareDates(date, t) > 0) {
      throw badRequest('settled_in_future', 'O pagamento não pode ter data futura.');
    }
    const accountId = body.accountId ?? card.paymentAccountId;
    if (!accountId) {
      throw badRequest('account_required', 'Escolha a conta de onde sai o pagamento.');
    }
    const ledger = await cardLedger(db, card, t, { to: month });
    const row = ledger.rows.find((r) => r.referenceMonth === month);
    const amount = body.amount ?? row?.remaining ?? 0;
    if (amount <= 0) throw badRequest('nothing_to_pay', 'Esta fatura não tem valor a pagar.');
    const userId = currentUser(request).id;
    await db.transaction(async (tx) => {
      await accountForEntry(tx, spaceId, accountId, date);
      const inv = await ensureInvoice(tx, card, month, userId);
      const [payment] = await tx
        .insert(invoicePayments)
        .values({ spaceId, createdBy: userId, invoiceId: inv.id, accountId, amount, date })
        .returning();
      if (!payment) throw new Error('falha ao registrar pagamento');
      const [txRow] = await tx
        .insert(transactions)
        .values({
          spaceId,
          createdBy: userId,
          type: 'expense',
          status: 'settled',
          amount,
          date,
          description: `Fatura ${card.name} ${monthName(month)}`,
          accountId,
          categoryId: await systemCategoryId(tx, spaceId, 'invoice_payment'),
          invoicePaymentId: payment.id,
          settledAt: new Date(),
        })
        .returning();
      if (!txRow) throw new Error('falha ao lançar pagamento');
      await tx
        .update(invoicePayments)
        .set({ transactionId: txRow.id })
        .where(eq(invoicePayments.id, payment.id));
    });
    return reply.code(201).send(await invoiceDetail(card, month));
  });

  /** Desfaz um pagamento (apaga o registro e o lançamento na conta). */
  app.delete('/cards/:id/invoices/:month/payments/:paymentId', async (request) => {
    const { spaceId, id, month, paymentId } = cardPaymentParamsSchema.parse(request.params);
    const card = await findCard(db, spaceId, id);
    const [payment] = await db
      .select({ payment: invoicePayments })
      .from(invoicePayments)
      .innerJoin(invoices, eq(invoices.id, invoicePayments.invoiceId))
      .where(
        and(
          eq(invoicePayments.id, paymentId),
          eq(invoicePayments.spaceId, spaceId),
          eq(invoices.cardId, card.id),
          eq(invoices.referenceMonth, month),
          isNull(invoicePayments.deletedAt),
        ),
      );
    if (!payment) throw notFound('Pagamento');
    const now = new Date();
    await db.transaction(async (tx) => {
      await tx
        .update(invoicePayments)
        .set({ deletedAt: now })
        .where(eq(invoicePayments.id, paymentId));
      if (payment.payment.transactionId) {
        await tx
          .update(transactions)
          .set({ deletedAt: now })
          .where(eq(transactions.id, payment.payment.transactionId));
      }
    });
    return invoiceDetail(card, month);
  });
}
