import { z } from 'zod';
import { CARD_BRANDS, INVOICE_STATUSES } from '../enums';
import { colorSchema, isoDateSchema, nameSchema, queryBooleanSchema } from './common';
import { transactionSchema } from './transactions';

const daySchema = z.int().min(1).max(31);
const yearMonthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'use o formato AAAA-MM');

/** Corpo de `POST /api/spaces/:spaceId/cards`. */
export const createCardBodySchema = z.object({
  name: nameSchema,
  brand: z.enum(CARD_BRANDS).nullish(),
  limitAmount: z.int().min(0),
  closingDay: daySchema,
  dueDay: daySchema,
  closingDayGoesToNext: z.boolean().default(true),
  paymentAccountId: z.uuid().nullish(),
  color: colorSchema.nullish(),
});
export type CreateCardBody = z.infer<typeof createCardBodySchema>;

export const updateCardBodySchema = z
  .object({
    name: nameSchema,
    brand: z.enum(CARD_BRANDS).nullable(),
    limitAmount: z.int().min(0),
    closingDay: daySchema,
    dueDay: daySchema,
    closingDayGoesToNext: z.boolean(),
    paymentAccountId: z.uuid().nullable(),
    color: colorSchema.nullable(),
    archived: z.boolean(),
  })
  .partial();
export type UpdateCardBody = z.infer<typeof updateCardBodySchema>;

export const listCardsQuerySchema = z.object({ includeArchived: queryBooleanSchema });

export const invoiceSummarySchema = z.object({
  referenceMonth: z.string(),
  closingDate: isoDateSchema,
  dueDate: isoDateSchema,
  closingDateOverride: isoDateSchema.nullable(),
  dueDateOverride: isoDateSchema.nullable(),
  status: z.enum(INVOICE_STATUSES),
  /** Σ itens (estornos negativos). */
  items: z.int(),
  /** Saldo anterior trazido do mês anterior (pagamento parcial vencido). */
  carried: z.int(),
  total: z.int(),
  paid: z.int(),
  /** Quanto falta pagar nesta fatura. */
  remaining: z.int(),
});
export type InvoiceSummary = z.infer<typeof invoiceSummarySchema>;

export const cardSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  brand: z.enum(CARD_BRANDS).nullable(),
  limitAmount: z.int(),
  closingDay: z.int(),
  dueDay: z.int(),
  closingDayGoesToNext: z.boolean(),
  paymentAccountId: z.uuid().nullable(),
  color: z.string().nullable(),
  archived: z.boolean(),
  /** Limite disponível (RN 4). */
  availableLimit: z.int(),
  /** Melhor dia de compra (dia do mês). */
  bestPurchaseDay: z.int(),
  /** Fatura em que cai uma compra feita hoje. */
  currentInvoice: invoiceSummarySchema,
});
export type Card = z.infer<typeof cardSchema>;

export const cardMonthParamsSchema = z.object({
  spaceId: z.uuid(),
  id: z.uuid(),
  month: yearMonthSchema,
});

export const listInvoicesQuerySchema = z.object({
  from: yearMonthSchema.optional(),
  to: yearMonthSchema.optional(),
});

export const invoicePaymentSchema = z.object({
  id: z.uuid(),
  accountId: z.uuid(),
  amount: z.int(),
  date: isoDateSchema,
  transactionId: z.uuid().nullable(),
});
export type InvoicePayment = z.infer<typeof invoicePaymentSchema>;

/** Resposta de `GET /cards/:id/invoices/:month`: resumo, itens e pagamentos. */
export const invoiceDetailSchema = invoiceSummarySchema.extend({
  cardId: z.uuid(),
  items: z.int(),
  entries: z.array(transactionSchema),
  payments: z.array(invoicePaymentSchema),
});
export type InvoiceDetail = z.infer<typeof invoiceDetailSchema>;

/** Corpo de `PATCH /cards/:id/invoices/:month`: datas que o banco mudou neste mês. */
export const updateInvoiceBodySchema = z
  .object({
    closingDateOverride: isoDateSchema.nullable(),
    dueDateOverride: isoDateSchema.nullable(),
  })
  .partial();
export type UpdateInvoiceBody = z.infer<typeof updateInvoiceBodySchema>;

/**
 * Corpo de `POST /cards/:id/invoices/:month/payments`. Padrões: conta de pagamento do
 * cartão, o que falta pagar e hoje.
 */
export const payInvoiceBodySchema = z.object({
  accountId: z.uuid().optional(),
  amount: z.int().positive().optional(),
  date: isoDateSchema.optional(),
});
export type PayInvoiceBody = z.infer<typeof payInvoiceBodySchema>;

export const cardPaymentParamsSchema = cardMonthParamsSchema.extend({ paymentId: z.uuid() });
