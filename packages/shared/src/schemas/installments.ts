import { z } from 'zod';
import { INSTALLMENT_PLAN_STATUSES } from '../enums';
import { isoDateSchema, nameSchema } from './common';
import { transactionSchema } from './transactions';

/**
 * Dados de um parcelamento (prévia e criação). No cartão (`cardId`) a 1ª parcela cai na
 * fatura da data da compra; fora dele (`accountId`, carnê/boleto) as parcelas vencem a
 * partir de `firstDueDate`. Informe o total **ou** o valor da parcela.
 * @see RN 5
 */
export const installmentPlanBodySchema = z
  .object({
    description: nameSchema,
    cardId: z.uuid().optional(),
    accountId: z.uuid().optional(),
    totalAmount: z.int().positive().optional(),
    installmentAmount: z.int().positive().optional(),
    installments: z.int().min(1).max(420),
    /** Data da compra. */
    firstDate: isoDateSchema,
    /** Vencimento da 1ª parcela (obrigatório fora do cartão). */
    firstDueDate: isoDateSchema.optional(),
    /** Fora do cartão: ajuste para dia útil. */
    adjust: z.enum(['none', 'previous', 'next']).default('none'),
    /** Plano já em andamento ("estou na parcela 4 de 10"). */
    startInstallment: z.int().min(1).default(1),
    categoryId: z.uuid().nullish(),
    interestAmount: z.int().min(0).default(0),
  })
  .refine((b) => Boolean(b.cardId) !== Boolean(b.accountId), {
    message: 'informe o cartão ou a conta (só um)',
    path: ['cardId'],
  })
  .refine((b) => (b.totalAmount === undefined) !== (b.installmentAmount === undefined), {
    message: 'informe o total ou o valor da parcela (só um)',
    path: ['totalAmount'],
  })
  .refine((b) => b.startInstallment <= b.installments, {
    message: 'a parcela inicial passa do número de parcelas',
    path: ['startInstallment'],
  })
  .refine((b) => b.cardId || b.firstDueDate, {
    message: 'informe o vencimento da 1ª parcela',
    path: ['firstDueDate'],
  });
export type InstallmentPlanBody = z.input<typeof installmentPlanBodySchema>;

export const installmentPreviewSchema = z.object({
  totalAmount: z.int(),
  installments: z.int(),
  items: z.array(
    z.object({
      number: z.int(),
      amount: z.int(),
      date: isoDateSchema,
      invoiceMonth: z.string().nullable(),
    }),
  ),
});
export type InstallmentPreview = z.infer<typeof installmentPreviewSchema>;

export const planSummarySchema = z.object({
  paidCount: z.int(),
  remainingCount: z.int(),
  paidAmount: z.int(),
  remainingAmount: z.int(),
  progressByAmount: z.number(),
  progressByCount: z.number(),
});

export const installmentPlanSchema = z.object({
  id: z.uuid(),
  description: z.string(),
  cardId: z.uuid().nullable(),
  accountId: z.uuid().nullable(),
  categoryId: z.uuid().nullable(),
  totalAmount: z.int(),
  installments: z.int(),
  startInstallment: z.int(),
  firstDate: isoDateSchema,
  firstDueDate: isoDateSchema.nullable(),
  interestAmount: z.int(),
  status: z.enum(INSTALLMENT_PLAN_STATUSES),
  summary: planSummarySchema,
  /** Próxima parcela ainda não paga. */
  next: z
    .object({
      number: z.int(),
      amount: z.int(),
      date: isoDateSchema,
      invoiceMonth: z.string().nullable(),
    })
    .nullable(),
});
export type InstallmentPlan = z.infer<typeof installmentPlanSchema>;

export const installmentPlanDetailSchema = installmentPlanSchema.extend({
  entries: z.array(transactionSchema),
});
export type InstallmentPlanDetail = z.infer<typeof installmentPlanDetailSchema>;

export const listInstallmentPlansQuerySchema = z.object({
  status: z.enum(INSTALLMENT_PLAN_STATUSES).optional(),
  cardId: z.uuid().optional(),
});

/** Corpo de `POST /installment-plans/:id/anticipate` (só no cartão). @see RN 5.5 */
export const anticipateBodySchema = z.object({
  count: z.int().min(1),
  discount: z
    .union([
      z.object({ amount: z.int().min(0) }),
      z.object({ monthlyRate: z.number().min(0).lt(1) }),
    ])
    .optional(),
});
export type AnticipateBody = z.infer<typeof anticipateBodySchema>;

/** Corpo de `POST /installment-plans/:id/cancel`. @see RN 5.4 */
export const cancelPlanBodySchema = z.object({
  /** O banco devolve as parcelas já faturadas (vira estorno na fatura aberta). */
  refundBilled: z.boolean().default(false),
});
