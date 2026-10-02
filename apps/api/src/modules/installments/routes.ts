import {
  accountInstallments,
  anticipateInstallments,
  cancelPlan,
  cardInstallments,
  compareDates,
  diffYearMonths,
  nationalHolidayDates,
  parseISODate,
  planSummary,
  type Installment,
  type InstallmentInvoiceStatus,
  type ISODate,
} from '@finapp/core';
import {
  anticipateBodySchema,
  cancelPlanBodySchema,
  installmentPlanBodySchema,
  listInstallmentPlansQuerySchema,
  spaceItemParamsSchema,
  type InstallmentPlan,
  type InstallmentPlanDetail,
  type InstallmentPreview,
} from '@finapp/shared';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { z } from 'zod';
import { installmentPlans, invoices, transactions } from '../../db/schema';
import type { DbExecutor } from '../../db/seed';
import { badRequest, notFound } from '../../http/errors';
import { currentUser } from '../../plugins/auth';
import { accountForEntry } from '../accounts/service';
import { cardForEntry, cardLedger, ensureInvoice, findCard, type CardRow } from '../cards/service';
import { categoryForEntry } from '../categories/routes';
import { spaceIdOf, type SpaceContext } from '../spaces/scope';
import { tagsOf, toTransaction, type TransactionRow } from '../transactions/service';

type PlanBody = z.output<typeof installmentPlanBodySchema>;
type PlanRow = typeof installmentPlans.$inferSelect;

const label = (description: string, k: number, n: number) => `${description} (${k}/${n})`;

/**
 * Compras parceladas no cartão e fora dele (carnê/boleto): prévia, criação, painel,
 * antecipação e cancelamento.
 * @see docs/api.md › Faturas e parcelamentos, RN 5
 */
export function installmentRoutes(app: FastifyInstance, { db, today }: SpaceContext) {
  /** Gera as parcelas pela regra do core (sem gravar). */
  const generate = async (
    tx: DbExecutor,
    spaceId: string,
    body: PlanBody,
  ): Promise<{ card: CardRow | null; items: Installment[]; total: number }> => {
    const amounts = {
      ...(body.totalAmount !== undefined ? { totalAmount: body.totalAmount } : {}),
      ...(body.installmentAmount !== undefined
        ? { installmentAmount: body.installmentAmount }
        : {}),
      installments: body.installments,
      startInstallment: body.startInstallment,
    };
    const total = body.totalAmount ?? (body.installmentAmount ?? 0) * body.installments;
    if (body.cardId) {
      const card = await cardForEntry(tx, spaceId, body.cardId);
      const rows = await tx
        .select()
        .from(invoices)
        .where(and(eq(invoices.cardId, card.id), isNull(invoices.deletedAt)));
      const byMonth = new Map(rows.map((r) => [r.referenceMonth, r]));
      const items = cardInstallments({
        ...amounts,
        card: {
          closingDay: card.closingDay,
          dueDay: card.dueDay,
          closingDayGoesToNext: card.closingDayGoesToNext,
        },
        firstDate: body.firstDate,
        currentDate: today(),
        overrides: (ym) => {
          const r = byMonth.get(ym);
          return r ? { closingDate: r.closingDateOverride, dueDate: r.dueDateOverride } : undefined;
        },
      });
      return { card, items, total };
    }
    const firstDue = body.firstDueDate as ISODate;
    const year = parseISODate(firstDue).year;
    const items = accountInstallments({
      ...amounts,
      firstDueDate: firstDue,
      adjust: body.adjust,
      holidays: nationalHolidayDates(year, year + Math.ceil(body.installments / 12) + 1),
    });
    return { card: null, items, total };
  };

  app.post('/installment-plans/preview', async (request): Promise<InstallmentPreview> => {
    const spaceId = spaceIdOf(request);
    const body = installmentPlanBodySchema.parse(request.body ?? {});
    const { items, total } = await generate(db, spaceId, body);
    return {
      totalAmount: total,
      installments: body.installments,
      items: items.map((i) => ({
        number: i.number,
        amount: i.amount,
        date: i.date,
        invoiceMonth: i.invoiceMonth ?? null,
      })),
    };
  });

  app.post('/installment-plans', async (request, reply) => {
    const spaceId = spaceIdOf(request);
    const body = installmentPlanBodySchema.parse(request.body ?? {});
    const userId = currentUser(request).id;
    const t = today();
    const planId = await db.transaction(async (tx) => {
      const { card, items, total } = await generate(tx, spaceId, body);
      if (body.accountId) await accountForEntry(tx, spaceId, body.accountId, items[0]?.date ?? t);
      if (body.categoryId) await categoryForEntry(tx, spaceId, body.categoryId, 'expense');
      const [plan] = await tx
        .insert(installmentPlans)
        .values({
          spaceId,
          createdBy: userId,
          description: body.description,
          totalAmount: total,
          installments: body.installments,
          firstDate: body.firstDate,
          firstDueDate: body.firstDueDate ?? null,
          cardId: body.cardId ?? null,
          accountId: body.accountId ?? null,
          categoryId: body.categoryId ?? null,
          interestAmount: body.interestAmount,
          startInstallment: body.startInstallment,
        })
        .returning();
      if (!plan) throw new Error('falha ao criar parcelamento');
      for (const i of items) {
        const invoiceId =
          card && i.invoiceMonth
            ? (await ensureInvoice(tx, card, i.invoiceMonth, userId)).id
            : null;
        // No cartão a parcela "acontece" na fatura; na conta, é um vencimento a pagar.
        const settled = card ? compareDates(i.date, t) <= 0 : false;
        await tx.insert(transactions).values({
          spaceId,
          createdBy: userId,
          type: 'expense',
          status: settled ? 'settled' : 'planned',
          amount: i.amount,
          date: i.date,
          description: label(body.description, i.number, body.installments),
          accountId: card ? null : (body.accountId ?? null),
          cardId: card?.id ?? null,
          invoiceId,
          categoryId: body.categoryId ?? null,
          paymentMethod: card ? 'credit' : 'boleto',
          installmentPlanId: plan.id,
          installmentNumber: i.number,
          settledAt: settled ? new Date() : null,
        });
      }
      return plan.id;
    });
    return reply.code(201).send(await detail(spaceId, planId));
  });

  /** Parcelas do plano com o status da fatura (cartão) ou do lançamento (conta). */
  const planState = async (plan: PlanRow) => {
    const entries = await db
      .select()
      .from(transactions)
      .where(and(eq(transactions.installmentPlanId, plan.id), isNull(transactions.deletedAt)))
      .orderBy(asc(transactions.installmentNumber));
    const statusOf = new Map<string, InstallmentInvoiceStatus>();
    const monthOf = new Map<string, string>();
    let openMonth: string | null = null;
    if (plan.cardId) {
      const card = await findCard(db, plan.spaceId, plan.cardId);
      const ledger = await cardLedger(db, card, today());
      openMonth = ledger.currentMonth;
      const invoiceRows = entries.length
        ? await db
            .select()
            .from(invoices)
            .where(
              inArray(
                invoices.id,
                entries.map((e) => e.invoiceId).filter((id): id is string => Boolean(id)),
              ),
            )
        : [];
      const byId = new Map(invoiceRows.map((r) => [r.id, r.referenceMonth]));
      const statusByMonth = new Map(ledger.rows.map((r) => [r.referenceMonth, r.status]));
      for (const e of entries) {
        const month = e.invoiceId ? byId.get(e.invoiceId) : undefined;
        if (!month) continue;
        monthOf.set(e.id, month);
        statusOf.set(
          e.id,
          diffYearMonths(ledger.currentMonth, month) > 0
            ? 'future'
            : (statusByMonth.get(month) ?? 'future'),
        );
      }
    } else {
      for (const e of entries) statusOf.set(e.id, e.status === 'settled' ? 'paid' : 'open');
    }
    return { entries, statusOf, monthOf, openMonth };
  };

  const toPlan = async (
    plan: PlanRow,
  ): Promise<{ plan: InstallmentPlan; entries: TransactionRow[] }> => {
    const { entries, statusOf, monthOf } = await planState(plan);
    const summary = planSummary(
      entries.map((e) => ({ amount: e.amount, invoiceStatus: statusOf.get(e.id) ?? 'future' })),
    );
    let status = plan.status;
    if (status !== 'cancelled') {
      status = entries.length > 0 && summary.remainingCount === 0 ? 'finished' : 'active';
      if (status !== plan.status) {
        await db.update(installmentPlans).set({ status }).where(eq(installmentPlans.id, plan.id));
      }
    }
    const next = entries.find((e) => statusOf.get(e.id) !== 'paid');
    const result: InstallmentPlan = {
      id: plan.id,
      description: plan.description,
      cardId: plan.cardId,
      accountId: plan.accountId,
      categoryId: plan.categoryId,
      totalAmount: plan.totalAmount,
      installments: plan.installments,
      startInstallment: plan.startInstallment,
      firstDate: plan.firstDate,
      firstDueDate: plan.firstDueDate,
      interestAmount: plan.interestAmount,
      status,
      summary,
      next:
        next && status === 'active'
          ? {
              number: next.installmentNumber ?? 0,
              amount: next.amount,
              date: next.date,
              invoiceMonth: monthOf.get(next.id) ?? null,
            }
          : null,
    };
    return { plan: result, entries };
  };

  const findPlan = async (spaceId: string, id: string) => {
    const [plan] = await db
      .select()
      .from(installmentPlans)
      .where(
        and(
          eq(installmentPlans.id, id),
          eq(installmentPlans.spaceId, spaceId),
          isNull(installmentPlans.deletedAt),
        ),
      );
    if (!plan) throw notFound('Parcelamento');
    return plan;
  };

  const detail = async (spaceId: string, id: string): Promise<InstallmentPlanDetail> => {
    const { plan, entries } = await toPlan(await findPlan(spaceId, id));
    const tagMap = await tagsOf(
      db,
      entries.map((e) => e.id),
    );
    return { ...plan, entries: entries.map((e) => toTransaction(e, tagMap.get(e.id) ?? [])) };
  };

  app.get('/installment-plans', async (request) => {
    const spaceId = spaceIdOf(request);
    const query = listInstallmentPlansQuerySchema.parse(request.query);
    const rows = await db
      .select()
      .from(installmentPlans)
      .where(
        and(
          eq(installmentPlans.spaceId, spaceId),
          isNull(installmentPlans.deletedAt),
          query.cardId ? eq(installmentPlans.cardId, query.cardId) : undefined,
        ),
      )
      .orderBy(desc(installmentPlans.firstDate), desc(installmentPlans.id));
    const plans = await Promise.all(rows.map(async (r) => (await toPlan(r)).plan));
    return { items: plans.filter((p) => !query.status || p.status === query.status) };
  });

  app.get('/installment-plans/:id', async (request) => {
    const { spaceId, id } = spaceItemParamsSchema.parse(request.params);
    return detail(spaceId, id);
  });

  /**
   * Antecipa as últimas `count` parcelas para a fatura aberta (só no cartão). O desconto
   * vira estorno "Desconto antecipação" na mesma fatura.
   * @see RN 5.5
   */
  app.post('/installment-plans/:id/anticipate', async (request) => {
    const { spaceId, id } = spaceItemParamsSchema.parse(request.params);
    const body = anticipateBodySchema.parse(request.body ?? {});
    const plan = await findPlan(spaceId, id);
    if (!plan.cardId) {
      throw badRequest('not_a_card_plan', 'Só parcelamentos no cartão podem ser antecipados.');
    }
    if (plan.status === 'cancelled') throw badRequest('plan_cancelled', 'Parcelamento cancelado.');
    const { entries, statusOf, monthOf, openMonth } = await planState(plan);
    if (!openMonth) throw new Error('fatura aberta não encontrada');
    const planned = entries
      .filter((e) => monthOf.has(e.id))
      .map((e) => ({
        number: e.installmentNumber ?? 0,
        amount: e.amount,
        invoiceMonth: monthOf.get(e.id) as string,
        invoiceStatus: statusOf.get(e.id) ?? 'future',
      }));
    let result;
    try {
      result = anticipateInstallments(planned, body.count, openMonth, body.discount);
    } catch (err) {
      throw badRequest('invalid_anticipation', (err as Error).message);
    }
    const card = await findCard(db, spaceId, plan.cardId);
    const userId = currentUser(request).id;
    const moved = new Set(result.moved.map((m) => m.number));
    await db.transaction(async (tx) => {
      const open = await ensureInvoice(tx, card, openMonth, userId);
      const ids = entries
        .filter((e) => e.installmentNumber !== null && moved.has(e.installmentNumber))
        .map((e) => e.id);
      await tx
        .update(transactions)
        .set({ invoiceId: open.id, anticipated: true })
        .where(inArray(transactions.id, ids));
      if (result.discount > 0) {
        const t = today();
        await tx.insert(transactions).values({
          spaceId,
          createdBy: userId,
          type: 'income',
          status: 'settled',
          amount: result.discount,
          date: t,
          description: `Desconto antecipação: ${plan.description}`,
          cardId: card.id,
          invoiceId: open.id,
          paymentMethod: 'credit',
          settledAt: new Date(),
        });
      }
    });
    return { ...(await detail(spaceId, id)), discount: result.discount, moved: result.moved };
  });

  /**
   * Cancela/devolve: parcelas em faturas abertas ou futuras são apagadas; as já faturadas
   * viram estorno na fatura aberta se o banco devolver. Fora do cartão, apaga as parcelas
   * ainda não pagas.
   * @see RN 5.4
   */
  app.post('/installment-plans/:id/cancel', async (request) => {
    const { spaceId, id } = spaceItemParamsSchema.parse(request.params);
    const body = cancelPlanBodySchema.parse(request.body ?? {});
    const plan = await findPlan(spaceId, id);
    if (plan.status === 'cancelled')
      throw badRequest('plan_cancelled', 'Parcelamento já cancelado.');
    const { entries, statusOf, openMonth } = await planState(plan);
    const userId = currentUser(request).id;
    const now = new Date();
    await db.transaction(async (tx) => {
      if (plan.cardId && openMonth) {
        const { cancel, refundAmount } = cancelPlan(
          entries.map((e) => ({
            number: e.installmentNumber ?? 0,
            amount: e.amount,
            invoiceMonth: '',
            invoiceStatus: statusOf.get(e.id) ?? 'future',
          })),
          { refundBilled: body.refundBilled },
        );
        const ids = entries
          .filter((e) => e.installmentNumber !== null && cancel.includes(e.installmentNumber))
          .map((e) => e.id);
        if (ids.length) {
          await tx
            .update(transactions)
            .set({ deletedAt: now })
            .where(inArray(transactions.id, ids));
        }
        if (refundAmount > 0) {
          const card = await findCard(tx, spaceId, plan.cardId);
          const open = await ensureInvoice(tx, card, openMonth, userId);
          await tx.insert(transactions).values({
            spaceId,
            createdBy: userId,
            type: 'income',
            status: 'settled',
            amount: refundAmount,
            date: today(),
            description: `Estorno: ${plan.description}`,
            cardId: card.id,
            invoiceId: open.id,
            paymentMethod: 'credit',
            settledAt: now,
          });
        }
      } else {
        const ids = entries.filter((e) => e.status !== 'settled').map((e) => e.id);
        if (ids.length) {
          await tx
            .update(transactions)
            .set({ deletedAt: now })
            .where(inArray(transactions.id, ids));
        }
      }
      await tx
        .update(installmentPlans)
        .set({ status: 'cancelled' })
        .where(eq(installmentPlans.id, plan.id));
    });
    return detail(spaceId, id);
  });
}
