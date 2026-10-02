import { z } from 'zod';
import { PAYMENT_METHODS, TRANSACTION_STATUSES, TRANSACTION_TYPES } from '../enums';
import { centsSchema, isoDateSchema, nameSchema, positiveCentsSchema } from './common';

const notesSchema = z.string().trim().max(2000);
const counterpartySchema = z.string().trim().min(1).max(120);

/**
 * Corpo de `POST /api/spaces/:spaceId/transactions`: receita ou despesa simples numa
 * conta (`accountId`) **ou** no cartão (`cardId`: despesa = compra, receita = estorno,
 * a fatura é escolhida pela data). Pix: `paymentMethod: 'pix'` com `pixCounterparty`
 * (quem recebeu/pagou) e/ou `contactId`.
 */
export const createTransactionBodySchema = z
  .object({
    type: z.enum(['income', 'expense']),
    status: z.enum(TRANSACTION_STATUSES).default('settled'),
    amount: positiveCentsSchema,
    date: isoDateSchema,
    description: nameSchema,
    notes: notesSchema.nullish(),
    accountId: z.uuid().optional(),
    cardId: z.uuid().optional(),
    categoryId: z.uuid().nullish(),
    paymentMethod: z.enum(PAYMENT_METHODS).nullish(),
    pixCounterparty: counterpartySchema.nullish(),
    contactId: z.uuid().nullish(),
    tagIds: z.array(z.uuid()).max(20).default([]),
  })
  .refine((b) => Boolean(b.accountId) !== Boolean(b.cardId), {
    message: 'informe a conta ou o cartão (só um)',
    path: ['accountId'],
  })
  .refine((b) => !b.cardId || !b.paymentMethod || b.paymentMethod === 'credit', {
    message: 'no cartão a forma de pagamento é crédito',
    path: ['paymentMethod'],
  })
  .refine((b) => !b.pixCounterparty || b.paymentMethod === 'pix', {
    message: 'pixCounterparty só vale com paymentMethod "pix"',
    path: ['pixCounterparty'],
  });
export type CreateTransactionBody = z.infer<typeof createTransactionBodySchema>;

/**
 * Corpo de `PATCH /transactions/:id`. Numa transferência, valor/data/descrição/status
 * valem para as duas pontas e `accountId` muda só a ponta editada; categoria, forma de
 * pagamento e Pix não se aplicam.
 */
export const updateTransactionBodySchema = z
  .object({
    status: z.enum(TRANSACTION_STATUSES),
    amount: positiveCentsSchema,
    date: isoDateSchema,
    description: nameSchema,
    notes: notesSchema.nullable(),
    accountId: z.uuid(),
    categoryId: z.uuid().nullable(),
    paymentMethod: z.enum(PAYMENT_METHODS).nullable(),
    pixCounterparty: counterpartySchema.nullable(),
    contactId: z.uuid().nullable(),
    tagIds: z.array(z.uuid()).max(20),
  })
  .partial();
export type UpdateTransactionBody = z.infer<typeof updateTransactionBodySchema>;

/** Corpo de `POST /transactions/:id/settle`: efetiva um previsto (valor/data/conta reais). */
export const settleTransactionBodySchema = z.object({
  amount: positiveCentsSchema.optional(),
  date: isoDateSchema.optional(),
  accountId: z.uuid().optional(),
});
export type SettleTransactionBody = z.infer<typeof settleTransactionBodySchema>;

/** Corpo de `POST /transfers`: duas pontas ligadas por `transferId`. */
export const createTransferBodySchema = z
  .object({
    fromAccountId: z.uuid(),
    toAccountId: z.uuid(),
    amount: positiveCentsSchema,
    date: isoDateSchema,
    status: z.enum(TRANSACTION_STATUSES).default('settled'),
    description: nameSchema.default('Transferência'),
    notes: notesSchema.nullish(),
  })
  .refine((b) => b.fromAccountId !== b.toAccountId, {
    message: 'contas de origem e destino devem ser diferentes',
    path: ['toAccountId'],
  });
export type CreateTransferBody = z.infer<typeof createTransferBodySchema>;

/**
 * Corpo de `POST /adjustments`: informe o saldo real da conta numa data; o ajuste é a
 * diferença para o saldo efetivado calculado até essa data.
 */
export const createAdjustmentBodySchema = z.object({
  accountId: z.uuid(),
  realBalance: centsSchema,
  date: isoDateSchema.optional(),
  description: nameSchema.default('Ajuste de saldo'),
  notes: notesSchema.nullish(),
});
export type CreateAdjustmentBody = z.infer<typeof createAdjustmentBodySchema>;

export const listTransactionsQuerySchema = z.object({
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  accountId: z.uuid().optional(),
  cardId: z.uuid().optional(),
  categoryId: z.uuid().optional(),
  type: z.enum(TRANSACTION_TYPES).optional(),
  status: z.enum(TRANSACTION_STATUSES).optional(),
  paymentMethod: z.enum(PAYMENT_METHODS).optional(),
  tag: z.uuid().optional(),
  /** Busca na descrição, observações e contraparte do Pix. */
  q: z.string().trim().min(1).max(100).optional(),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListTransactionsQuery = z.infer<typeof listTransactionsQuerySchema>;

export const transactionSchema = z.object({
  id: z.uuid(),
  type: z.enum(TRANSACTION_TYPES),
  status: z.enum(TRANSACTION_STATUSES),
  /** Positivo; no ajuste, a diferença com sinal. */
  amount: z.int(),
  date: isoDateSchema,
  description: z.string(),
  notes: z.string().nullable(),
  accountId: z.uuid().nullable(),
  /** Item de cartão: o cartão e a fatura (sem conta). */
  cardId: z.uuid().nullable(),
  invoiceId: z.uuid().nullable(),
  installmentPlanId: z.uuid().nullable(),
  installmentNumber: z.int().nullable(),
  /** Parcela antecipada para a fatura aberta. */
  anticipated: z.boolean(),
  /** Gerado por uma recorrência. */
  recurrenceId: z.uuid().nullable(),
  /** Valor estimado (conta variável), a confirmar com o valor real. */
  estimated: z.boolean(),
  categoryId: z.uuid().nullable(),
  paymentMethod: z.enum(PAYMENT_METHODS).nullable(),
  pixCounterparty: z.string().nullable(),
  contactId: z.uuid().nullable(),
  transferId: z.uuid().nullable(),
  tagIds: z.array(z.uuid()),
  settledAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type Transaction = z.infer<typeof transactionSchema>;

export const transactionListSchema = z.object({
  items: z.array(transactionSchema),
  nextCursor: z.string().nullable(),
});
export type TransactionList = z.infer<typeof transactionListSchema>;
