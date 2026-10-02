import { adjustmentAmount, compareDates, type ISODate } from '@finapp/core';
import {
  createAdjustmentBodySchema,
  createTransactionBodySchema,
  createTransferBodySchema,
  listTransactionsQuerySchema,
  settleTransactionBodySchema,
  spaceItemParamsSchema,
  updateTransactionBodySchema,
  type TransactionList,
} from '@finapp/shared';
import {
  and,
  desc,
  eq,
  exists,
  gte,
  ilike,
  inArray,
  isNull,
  lt,
  lte,
  or,
  type SQL,
} from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { uuidv7 } from 'uuidv7';
import { invoicePayments, transactions, transactionTags } from '../../db/schema';
import type { DbExecutor } from '../../db/seed';
import { badRequest } from '../../http/errors';
import { currentUser } from '../../plugins/auth';
import { accountForEdit, accountForEntry, balancesFor } from '../accounts/service';
import { cardForEntry, ensureInvoice, findCard, invoiceMonthFor } from '../cards/service';
import { categoryForEntry, systemCategoryId } from '../categories/routes';
import { spaceIdOf, type SpaceContext } from '../spaces/scope';
import {
  assertContact,
  decodeCursor,
  encodeCursor,
  findTransaction,
  setTags,
  tagsOf,
  toTransaction,
  transferLegs,
  type TransactionRow,
} from './service';

const escapeLike = (text: string) => text.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Lançamentos, transferências e ajustes de saldo. Todo lançamento fica numa conta do
 * espaço (cartões entram na Fase 3).
 * @see docs/api.md › Lançamentos, RN 1
 */
export function transactionRoutes(app: FastifyInstance, { db, today }: SpaceContext) {
  /** Efetivado não pode ter data futura: o que ainda vai acontecer é previsto. */
  const assertSettledDate = (status: string, date: ISODate) => {
    if (status === 'settled' && compareDates(date, today()) > 0) {
      throw badRequest(
        'settled_in_future',
        'Lançamento efetivado não pode ter data futura: use "previsto".',
      );
    }
  };

  const withTags = async (rows: TransactionRow[]) => {
    const tagMap = await tagsOf(
      db,
      rows.map((r) => r.id),
    );
    return rows.map((r) => toTransaction(r, tagMap.get(r.id) ?? []));
  };

  app.get('/transactions', async (request): Promise<TransactionList> => {
    const spaceId = spaceIdOf(request);
    const q = listTransactionsQuerySchema.parse(request.query);
    const filters: (SQL | undefined)[] = [
      eq(transactions.spaceId, spaceId),
      isNull(transactions.deletedAt),
      q.from ? gte(transactions.date, q.from) : undefined,
      q.to ? lte(transactions.date, q.to) : undefined,
      q.accountId ? eq(transactions.accountId, q.accountId) : undefined,
      q.cardId ? eq(transactions.cardId, q.cardId) : undefined,
      q.categoryId ? eq(transactions.categoryId, q.categoryId) : undefined,
      q.type ? eq(transactions.type, q.type) : undefined,
      q.status ? eq(transactions.status, q.status) : undefined,
      q.paymentMethod ? eq(transactions.paymentMethod, q.paymentMethod) : undefined,
      q.tag
        ? exists(
            db
              .select({ tagId: transactionTags.tagId })
              .from(transactionTags)
              .where(
                and(
                  eq(transactionTags.transactionId, transactions.id),
                  eq(transactionTags.tagId, q.tag),
                ),
              ),
          )
        : undefined,
      q.q
        ? or(
            ilike(transactions.description, `%${escapeLike(q.q)}%`),
            ilike(transactions.notes, `%${escapeLike(q.q)}%`),
            ilike(transactions.pixCounterparty, `%${escapeLike(q.q)}%`),
          )
        : undefined,
    ];
    if (q.cursor) {
      const c = decodeCursor(q.cursor);
      filters.push(
        or(
          lt(transactions.date, c.date),
          and(eq(transactions.date, c.date), lt(transactions.id, c.id)),
        ),
      );
    }
    const rows = await db
      .select()
      .from(transactions)
      .where(and(...filters))
      .orderBy(desc(transactions.date), desc(transactions.id))
      .limit(q.limit + 1);
    const page = rows.slice(0, q.limit);
    const last = page.at(-1);
    return {
      items: await withTags(page),
      nextCursor: rows.length > q.limit && last ? encodeCursor(last) : null,
    };
  });

  app.get('/transactions/:id', async (request) => {
    const { spaceId, id } = spaceItemParamsSchema.parse(request.params);
    const [item] = await withTags([await findTransaction(db, spaceId, id)]);
    return item;
  });

  /**
   * Receita ou despesa simples numa conta (inclusive Pix), ou item de cartão: despesa é
   * compra e receita é estorno, na fatura em que cai a data (RN 4).
   */
  app.post('/transactions', async (request, reply) => {
    const spaceId = spaceIdOf(request);
    const body = createTransactionBodySchema.parse(request.body ?? {});
    assertSettledDate(body.status, body.date);
    const userId = currentUser(request).id;
    const row = await db.transaction(async (tx) => {
      let invoiceId: string | null = null;
      if (body.cardId) {
        const card = await cardForEntry(tx, spaceId, body.cardId);
        const month = await invoiceMonthFor(tx, card, body.date);
        invoiceId = (await ensureInvoice(tx, card, month, userId)).id;
      } else if (body.accountId) {
        await accountForEntry(tx, spaceId, body.accountId, body.date);
      }
      if (body.categoryId) await categoryForEntry(tx, spaceId, body.categoryId, body.type);
      if (body.contactId) await assertContact(tx, spaceId, body.contactId);
      const [inserted] = await tx
        .insert(transactions)
        .values({
          spaceId,
          createdBy: userId,
          type: body.type,
          status: body.status,
          amount: body.amount,
          date: body.date,
          description: body.description,
          notes: body.notes ?? null,
          accountId: body.accountId ?? null,
          cardId: body.cardId ?? null,
          invoiceId,
          categoryId: body.categoryId ?? null,
          paymentMethod: body.cardId ? 'credit' : (body.paymentMethod ?? null),
          pixCounterparty: body.pixCounterparty ?? null,
          contactId: body.contactId ?? null,
          settledAt: body.status === 'settled' ? new Date() : null,
        })
        .returning();
      if (!inserted) throw new Error('falha ao criar lançamento');
      await setTags(tx, spaceId, inserted.id, body.tagIds);
      return inserted;
    });
    const [item] = await withTags([row]);
    return reply.code(201).send(item);
  });

  app.patch('/transactions/:id', async (request) => {
    const { spaceId, id } = spaceItemParamsSchema.parse(request.params);
    const body = updateTransactionBodySchema.parse(request.body ?? {});
    const updated = await db.transaction(async (tx) => {
      const current = await findTransaction(tx, spaceId, id);
      if (current.type === 'adjustment') {
        const allowed = new Set(['description', 'notes', 'tagIds']);
        if (Object.keys(body).some((k) => !allowed.has(k))) {
          throw badRequest(
            'adjustment_locked',
            'No ajuste só a descrição, as observações e as tags mudam: exclua e ajuste de novo.',
          );
        }
      }
      if (current.installmentPlanId) {
        const allowed = new Set(['description', 'notes', 'tagIds', 'categoryId', 'status']);
        if (Object.keys(body).some((k) => !allowed.has(k))) {
          throw badRequest(
            'installment_locked',
            'Parcela: valor, data e conta vêm do parcelamento. Para mudar, cancele ou antecipe.',
          );
        }
      }
      if (current.invoicePaymentId) {
        const allowed = new Set(['description', 'notes', 'tagIds']);
        if (Object.keys(body).some((k) => !allowed.has(k))) {
          throw badRequest(
            'invoice_payment_locked',
            'Pagamento de fatura: para mudar valor, data ou conta, exclua e pague de novo.',
          );
        }
      }
      if (current.transferId) return updateTransfer(tx, spaceId, current, body);
      if (current.cardId)
        return updateCardItem(tx, spaceId, current, body, currentUser(request).id);

      const next = {
        status: body.status ?? current.status,
        date: body.date ?? current.date,
        accountId: body.accountId ?? current.accountId,
        paymentMethod:
          body.paymentMethod !== undefined ? body.paymentMethod : current.paymentMethod,
        pixCounterparty:
          body.pixCounterparty !== undefined ? body.pixCounterparty : current.pixCounterparty,
      };
      assertSettledDate(next.status, next.date);
      if (next.pixCounterparty && next.paymentMethod !== 'pix') {
        throw badRequest('pix_counterparty_without_pix', 'Contraparte só vale para Pix.');
      }
      if (next.accountId && (body.accountId !== undefined || body.date !== undefined)) {
        // Conta arquivada continua aceitando edição de lançamentos que já estão nela.
        const moved = body.accountId !== undefined && body.accountId !== current.accountId;
        await (moved ? accountForEntry : accountForEdit)(tx, spaceId, next.accountId, next.date);
      }
      if (body.categoryId && current.type !== 'adjustment') {
        await categoryForEntry(
          tx,
          spaceId,
          body.categoryId,
          current.type === 'income' ? 'income' : 'expense',
        );
      }
      if (body.contactId) await assertContact(tx, spaceId, body.contactId);
      const { tagIds, ...fields } = body;
      const [row] = await tx
        .update(transactions)
        .set({
          ...fields,
          ...(body.status && body.status !== current.status
            ? { settledAt: body.status === 'settled' ? new Date() : null }
            : {}),
        })
        .where(eq(transactions.id, id))
        .returning();
      if (!row) throw new Error('falha ao atualizar lançamento');
      if (tagIds) await setTags(tx, spaceId, id, tagIds);
      return row;
    });
    const [item] = await withTags([updated]);
    return item;
  });

  /** Numa transferência, valor/data/descrição/status valem para as duas pontas. */
  const updateTransfer = async (
    tx: DbExecutor,
    spaceId: string,
    current: TransactionRow,
    body: ReturnType<typeof updateTransactionBodySchema.parse>,
  ) => {
    const notForTransfers = [
      'categoryId',
      'paymentMethod',
      'pixCounterparty',
      'contactId',
    ] as const;
    if (notForTransfers.some((k) => body[k] !== undefined)) {
      throw badRequest(
        'transfer_field',
        'Transferência não tem categoria, forma de pagamento, Pix ou contato.',
      );
    }
    const legs = await transferLegs(tx, spaceId, current.transferId as string);
    const other = legs.find((l) => l.id !== current.id);
    const date = body.date ?? current.date;
    const status = body.status ?? current.status;
    assertSettledDate(status, date);
    const accountId = body.accountId ?? current.accountId;
    if (other && accountId === other.accountId) {
      throw badRequest('same_account', 'Contas de origem e destino devem ser diferentes.');
    }
    for (const leg of legs) {
      const legAccount = leg.id === current.id ? accountId : leg.accountId;
      if (!legAccount) continue;
      const moved =
        leg.id === current.id && body.accountId !== undefined && body.accountId !== leg.accountId;
      if (moved) await accountForEntry(tx, spaceId, legAccount, date);
      else if (body.date !== undefined) await accountForEdit(tx, spaceId, legAccount, date);
    }
    const shared = {
      ...(body.amount !== undefined ? { amount: body.amount } : {}),
      ...(body.date !== undefined ? { date: body.date } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.notes !== undefined ? { notes: body.notes } : {}),
      ...(body.status !== undefined && body.status !== current.status
        ? { status: body.status, settledAt: body.status === 'settled' ? new Date() : null }
        : {}),
    };
    if (Object.keys(shared).length) {
      await tx
        .update(transactions)
        .set(shared)
        .where(
          inArray(
            transactions.id,
            legs.map((l) => l.id),
          ),
        );
    }
    if (body.accountId !== undefined) {
      await tx.update(transactions).set({ accountId }).where(eq(transactions.id, current.id));
    }
    if (body.tagIds) await setTags(tx, spaceId, current.id, body.tagIds);
    return findTransaction(tx, spaceId, current.id);
  };

  /**
   * Item de cartão: valor, data (a fatura acompanha a data, exceto parcelas), descrição,
   * categoria, status e tags. Não vira lançamento de conta.
   */
  const updateCardItem = async (
    tx: DbExecutor,
    spaceId: string,
    current: TransactionRow,
    body: ReturnType<typeof updateTransactionBodySchema.parse>,
    userId: string,
  ) => {
    if (body.accountId !== undefined || body.pixCounterparty || body.paymentMethod) {
      throw badRequest(
        'card_item_field',
        'Item de cartão não tem conta, Pix ou outra forma de pagamento.',
      );
    }
    const status = body.status ?? current.status;
    const date = body.date ?? current.date;
    assertSettledDate(status, date);
    if (body.categoryId) {
      await categoryForEntry(
        tx,
        spaceId,
        body.categoryId,
        current.type === 'income' ? 'income' : 'expense',
      );
    }
    if (body.contactId) await assertContact(tx, spaceId, body.contactId);
    let invoiceId = current.invoiceId;
    if (body.date !== undefined && body.date !== current.date && !current.installmentPlanId) {
      const card = await findCard(tx, spaceId, current.cardId as string);
      invoiceId = (await ensureInvoice(tx, card, await invoiceMonthFor(tx, card, date), userId)).id;
    }
    const { tagIds, ...fields } = body;
    const [row] = await tx
      .update(transactions)
      .set({
        ...fields,
        invoiceId,
        ...(body.status && body.status !== current.status
          ? { settledAt: body.status === 'settled' ? new Date() : null }
          : {}),
      })
      .where(eq(transactions.id, current.id))
      .returning();
    if (!row) throw new Error('falha ao atualizar item do cartão');
    if (tagIds) await setTags(tx, spaceId, current.id, tagIds);
    return row;
  };

  /**
   * Exclusão lógica; numa transferência, apaga as duas pontas; num pagamento de fatura,
   * apaga também o registro do pagamento.
   */
  app.delete('/transactions/:id', async (request, reply) => {
    const { spaceId, id } = spaceItemParamsSchema.parse(request.params);
    const current = await findTransaction(db, spaceId, id);
    if (current.installmentPlanId) {
      throw badRequest(
        'installment_locked',
        'Parcela não é excluída sozinha: cancele o parcelamento.',
      );
    }
    const now = new Date();
    await db.transaction(async (tx) => {
      await tx
        .update(transactions)
        .set({ deletedAt: now })
        .where(
          current.transferId
            ? and(
                eq(transactions.transferId, current.transferId),
                eq(transactions.spaceId, spaceId),
              )
            : eq(transactions.id, id),
        );
      if (current.invoicePaymentId) {
        await tx
          .update(invoicePayments)
          .set({ deletedAt: now })
          .where(eq(invoicePayments.id, current.invoicePaymentId));
      }
    });
    return reply.code(204).send();
  });

  /**
   * Efetiva um previsto, com valor/data/conta reais. Data padrão: a prevista, se já
   * passou; senão hoje. Numa transferência, efetiva as duas pontas (sem trocar conta).
   */
  app.post('/transactions/:id/settle', async (request) => {
    const { spaceId, id } = spaceItemParamsSchema.parse(request.params);
    const body = settleTransactionBodySchema.parse(request.body ?? {});
    const updated = await db.transaction(async (tx) => {
      const current = await findTransaction(tx, spaceId, id);
      if (current.status === 'settled') {
        throw badRequest('already_settled', 'Este lançamento já está efetivado.');
      }
      const t = today();
      const date = body.date ?? (compareDates(current.date, t) <= 0 ? current.date : t);
      assertSettledDate('settled', date);
      const values = {
        status: 'settled' as const,
        settledAt: new Date(),
        date,
        ...(body.amount !== undefined ? { amount: body.amount } : {}),
      };
      if (current.transferId) {
        if (body.accountId !== undefined) {
          throw badRequest('transfer_field', 'Para trocar a conta da transferência, edite-a.');
        }
        const legs = await transferLegs(tx, spaceId, current.transferId);
        for (const leg of legs) {
          if (leg.accountId) await accountForEdit(tx, spaceId, leg.accountId, date);
        }
        await tx
          .update(transactions)
          .set(values)
          .where(
            inArray(
              transactions.id,
              legs.map((l) => l.id),
            ),
          );
        return findTransaction(tx, spaceId, id);
      }
      if (current.cardId && body.accountId !== undefined) {
        throw badRequest('card_item_field', 'Item de cartão não tem conta.');
      }
      const accountId = body.accountId ?? current.accountId;
      if (accountId) {
        const moved = body.accountId !== undefined && body.accountId !== current.accountId;
        await (moved ? accountForEntry : accountForEdit)(tx, spaceId, accountId, date);
      }
      const [row] = await tx
        .update(transactions)
        .set({ ...values, accountId })
        .where(eq(transactions.id, id))
        .returning();
      if (!row) throw new Error('falha ao efetivar');
      return row;
    });
    const [item] = await withTags([updated]);
    return item;
  });

  /** Transferência entre contas do espaço: saída na origem e entrada no destino. */
  app.post('/transfers', async (request, reply) => {
    const spaceId = spaceIdOf(request);
    const body = createTransferBodySchema.parse(request.body ?? {});
    assertSettledDate(body.status, body.date);
    const legs = await db.transaction(async (tx) => {
      await accountForEntry(tx, spaceId, body.fromAccountId, body.date);
      await accountForEntry(tx, spaceId, body.toAccountId, body.date);
      const transferId = uuidv7();
      const common = {
        spaceId,
        createdBy: currentUser(request).id,
        status: body.status,
        amount: body.amount,
        date: body.date,
        description: body.description,
        notes: body.notes ?? null,
        categoryId: await systemCategoryId(tx, spaceId, 'transfer'),
        transferId,
        settledAt: body.status === 'settled' ? new Date() : null,
      };
      return tx
        .insert(transactions)
        .values([
          { ...common, type: 'transfer_out' as const, accountId: body.fromAccountId },
          { ...common, type: 'transfer_in' as const, accountId: body.toAccountId },
        ])
        .returning();
    });
    const items = await withTags(legs);
    return reply.code(201).send({ transferId: legs[0]?.transferId ?? null, items });
  });

  /**
   * Ajuste de saldo: lança a diferença entre o saldo real informado e o saldo efetivado
   * calculado até a data (RN 1). Sem diferença, não cria nada.
   */
  app.post('/adjustments', async (request, reply) => {
    const spaceId = spaceIdOf(request);
    const body = createAdjustmentBodySchema.parse(request.body ?? {});
    const t = today();
    const date = body.date ?? t;
    assertSettledDate('settled', date);
    const account = await accountForEntry(db, spaceId, body.accountId, date);
    const balance = (await balancesFor(db, spaceId, [account], date, date)).get(account.id);
    if (!balance) throw new Error('saldo não calculado');
    const diff = adjustmentAmount(balance.current, body.realBalance);
    if (diff === null) return reply.code(200).send({ adjustment: null, balance: balance.current });
    const [row] = await db
      .insert(transactions)
      .values({
        spaceId,
        createdBy: currentUser(request).id,
        type: 'adjustment',
        status: 'settled',
        amount: diff,
        date,
        description: body.description,
        notes: body.notes ?? null,
        accountId: account.id,
        categoryId: await systemCategoryId(db, spaceId, 'adjustment'),
        settledAt: new Date(),
      })
      .returning();
    if (!row) throw new Error('falha ao criar ajuste');
    return reply.code(201).send({ adjustment: toTransaction(row), balance: body.realBalance });
  });
}
