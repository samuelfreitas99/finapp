import { z } from 'zod';
import {
  DEBT_DIRECTIONS,
  DEBT_INDEXES,
  DEBT_INSTALLMENT_STATUSES,
  DEBT_KINDS,
  DEBT_STATUSES,
  DEBT_SYSTEMS,
} from '../enums';
import { isoDateSchema, nameSchema } from './common';

const yearMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'use o formato AAAA-MM');
const rate = z.number().min(0).lt(1);

/**
 * Uma fase da dívida. Por sistema:
 * - `fixed`: `installments` + (`installmentAmount` **ou** `total`).
 * - `price`/`sac`: `principal`, taxa (`rateMonthly` **ou** `rateAnnual`), `installments`.
 * - `variable`: `values` (valor por mês) até `lastMonth` ou até a entrega (`endsAtCompletion`).
 * - `balloon`: `payments` (datas e valores).
 * Fases que começam depois da entrega das chaves: `startsAfterCompletion`.
 * @see RN 6.1, 6.7
 */
export const debtPhaseBodySchema = z
  .object({
    name: z.string().trim().min(1).max(60).default('Parcelas'),
    system: z.enum(DEBT_SYSTEMS),
    firstDueDate: isoDateSchema,
    installments: z.int().min(1).max(600).optional(),
    installmentAmount: z.int().positive().optional(),
    total: z.int().positive().optional(),
    principal: z.int().positive().optional(),
    rateMonthly: rate.optional(),
    rateAnnual: z.number().min(0).max(10).optional(),
    index: z.enum(DEBT_INDEXES).default('none'),
    values: z
      .array(z.object({ month: yearMonth, amount: z.int().min(0) }))
      .max(600)
      .optional(),
    lastMonth: yearMonth.optional(),
    endsAtCompletion: z.boolean().default(false),
    startsAfterCompletion: z.boolean().default(false),
    payments: z
      .array(z.object({ dueDate: isoDateSchema, amount: z.int().positive() }))
      .max(120)
      .optional(),
  })
  .superRefine((p, ctx) => {
    const need = (ok: boolean, message: string, path: string) => {
      if (!ok) ctx.addIssue({ code: 'custom', message, path: [path] });
    };
    if (p.system === 'fixed') {
      need(Boolean(p.installments), 'informe o número de parcelas', 'installments');
      need(
        (p.installmentAmount === undefined) !== (p.total === undefined),
        'informe o valor da parcela ou o total (só um)',
        'installmentAmount',
      );
    }
    if (p.system === 'price' || p.system === 'sac') {
      need(Boolean(p.principal), 'informe o valor financiado', 'principal');
      need(Boolean(p.installments), 'informe o número de parcelas', 'installments');
      need(
        (p.rateMonthly === undefined) !== (p.rateAnnual === undefined),
        'informe a taxa mensal ou anual (só uma)',
        'rateMonthly',
      );
    }
    if (p.system === 'variable') {
      need(Boolean(p.values?.length), 'informe ao menos um valor mensal', 'values');
      need(
        Boolean(p.lastMonth) || p.endsAtCompletion,
        'informe até quando vai a fase',
        'lastMonth',
      );
    }
    if (p.system === 'balloon') {
      need(Boolean(p.payments?.length), 'informe as parcelas (datas e valores)', 'payments');
    }
  });
export type DebtPhaseBody = z.input<typeof debtPhaseBodySchema>;

/** Corpo de `POST /debts` e `/debts/preview`. @see RN 6 */
export const debtBodySchema = z
  .object({
    name: nameSchema,
    direction: z.enum(DEBT_DIRECTIONS).default('i_owe'),
    kind: z.enum(DEBT_KINDS),
    contactId: z.uuid().nullish(),
    institution: z.string().trim().max(120).nullish(),
    /** Valor recebido/emprestado (padrão: soma do principal das fases). */
    principal: z.int().min(0).optional(),
    paymentAccountId: z.uuid().nullish(),
    paymentCardId: z.uuid().nullish(),
    completionDate: isoDateSchema.nullish(),
    assetValue: z.int().min(0).nullish(),
    notes: z.string().trim().max(2000).nullish(),
    /** Dívida em andamento: as primeiras N parcelas já foram pagas (sem lançamento). */
    paidInstallments: z.int().min(0).default(0),
    /**
     * Conta onde o dinheiro entrou (peguei, empréstimo no cartão/banco) ou de onde saiu
     * (emprestei), na data `moneyDate` (padrão hoje). Fica fora dos relatórios de renda e
     * gasto (categoria técnica "Empréstimo"). Usa o `principal`.
     * @see RN 6.6
     */
    moneyAccountId: z.uuid().nullish(),
    moneyDate: isoDateSchema.optional(),
    phases: z.array(debtPhaseBodySchema).min(1).max(8),
  })
  .refine((b) => !(b.paymentAccountId && b.paymentCardId), {
    message: 'pague por conta ou por cartão (só um)',
    path: ['paymentCardId'],
  })
  .refine((b) => b.kind !== 'third_party_card' || !b.paymentCardId, {
    message: 'cartão de outra pessoa não entra nas suas faturas: pague por uma conta',
    path: ['paymentCardId'],
  })
  .refine((b) => b.kind !== 'card_loan' || Boolean(b.paymentCardId), {
    message: 'empréstimo no cartão: escolha o cartão que recebe as parcelas',
    path: ['paymentCardId'],
  })
  .refine((b) => !b.moneyAccountId || (b.principal ?? 0) > 0, {
    message: 'informe o valor recebido ou emprestado',
    path: ['principal'],
  })
  .refine(
    (b) =>
      Boolean(b.completionDate) ||
      b.phases.every((p) => !p.endsAtCompletion && !p.startsAfterCompletion),
    { message: 'informe a data de entrega das chaves', path: ['completionDate'] },
  );
export type DebtBody = z.input<typeof debtBodySchema>;

export const updateDebtBodySchema = z
  .object({
    name: nameSchema,
    contactId: z.uuid().nullable(),
    institution: z.string().trim().max(120).nullable(),
    assetValue: z.int().min(0).nullable(),
    notes: z.string().trim().max(2000).nullable(),
  })
  .partial();
export type UpdateDebtBody = z.infer<typeof updateDebtBodySchema>;

export const debtSummarySchema = z.object({
  totalCount: z.int(),
  paidCount: z.int(),
  remainingCount: z.int(),
  paidAmount: z.int(),
  remainingAmount: z.int(),
  outstandingPrincipal: z.int(),
  progressByAmount: z.number(),
  progressByCount: z.number(),
  interestPaid: z.int(),
  interestToPay: z.int(),
  expectedPayoffDate: isoDateSchema.nullable(),
  lateCount: z.int(),
  lateAmount: z.int(),
});
export type DebtSummaryDto = z.infer<typeof debtSummarySchema>;

export const debtInstallmentSchema = z.object({
  id: z.uuid(),
  phaseId: z.uuid(),
  number: z.int(),
  phaseNumber: z.int(),
  dueDate: isoDateSchema,
  amount: z.int(),
  principalPart: z.int(),
  interestPart: z.int(),
  estimated: z.boolean(),
  paidAmount: z.int(),
  paidDate: isoDateSchema.nullable(),
  discount: z.int(),
  status: z.enum(DEBT_INSTALLMENT_STATUSES),
});
export type DebtInstallmentDto = z.infer<typeof debtInstallmentSchema>;

export const debtPhaseSchema = z.object({
  id: z.uuid(),
  position: z.int(),
  name: z.string(),
  system: z.enum(DEBT_SYSTEMS),
  principal: z.int().nullable(),
  rateMonthly: z.number(),
  index: z.enum(DEBT_INDEXES),
  installments: z.int().nullable(),
  startDate: isoDateSchema,
  endDate: isoDateSchema.nullable(),
  endsAtCompletion: z.boolean(),
  startsAfterCompletion: z.boolean(),
  summary: debtSummarySchema,
});

export const debtSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  direction: z.enum(DEBT_DIRECTIONS),
  kind: z.enum(DEBT_KINDS),
  contactId: z.uuid().nullable(),
  institution: z.string().nullable(),
  principal: z.int(),
  paymentAccountId: z.uuid().nullable(),
  paymentCardId: z.uuid().nullable(),
  completionDate: isoDateSchema.nullable(),
  assetValue: z.int().nullable(),
  /** Patrimônio líquido: valor do bem − saldo devedor (imóvel). */
  equity: z.int().nullable(),
  status: z.enum(DEBT_STATUSES),
  notes: z.string().nullable(),
  summary: debtSummarySchema,
  next: debtInstallmentSchema.nullable(),
});
export type Debt = z.infer<typeof debtSchema>;

export const debtDetailSchema = debtSchema.extend({
  phases: z.array(debtPhaseSchema),
  installments: z.array(debtInstallmentSchema),
});
export type DebtDetail = z.infer<typeof debtDetailSchema>;

export const debtPreviewSchema = z.object({
  rows: z.array(
    z.object({
      number: z.int(),
      phase: z.int(),
      phaseNumber: z.int(),
      dueDate: isoDateSchema,
      amount: z.int(),
      principalPart: z.int(),
      interestPart: z.int(),
      balanceAfter: z.int(),
      estimated: z.boolean(),
    }),
  ),
  summary: debtSummarySchema,
});
export type DebtPreview = z.infer<typeof debtPreviewSchema>;

/**
 * Corpo de `POST /debts/:id/installments/:number/pay`. Padrões: o que falta da parcela,
 * hoje, a conta da dívida. Desconto (pagar adiantado): valor **ou** taxa mensal (valor
 * presente, arredondado para baixo).
 * @see RN 6.3, 6.5
 */
export const payInstallmentBodySchema = z
  .object({
    amount: z.int().positive().optional(),
    date: isoDateSchema.optional(),
    accountId: z.uuid().optional(),
    discount: z.int().min(0).optional(),
    discountMonthlyRate: z.number().min(0).lt(1).optional(),
  })
  .refine((b) => b.discount === undefined || b.discountMonthlyRate === undefined, {
    message: 'informe o desconto em valor ou em taxa (só um)',
    path: ['discount'],
  });
export type PayInstallmentBody = z.input<typeof payInstallmentBodySchema>;

/** Corpo de `POST /debts/:id/amortize` (price/sac). @see RN 6.5 */
export const amortizeBodySchema = z.object({
  amount: z.int().positive(),
  mode: z.enum(['reduce_term', 'reduce_installment']),
  phaseId: z.uuid().optional(),
  date: isoDateSchema.optional(),
  accountId: z.uuid().optional(),
});
export type AmortizeBody = z.input<typeof amortizeBodySchema>;

/** Corpo de `POST /debts/:id/payoff`: quitação total pelo saldo devedor. @see RN 6.5 */
export const payoffBodySchema = z.object({
  date: isoDateSchema.optional(),
  accountId: z.uuid().optional(),
});
export type PayoffBody = z.input<typeof payoffBodySchema>;

export const debtInstallmentParamsSchema = z.object({
  spaceId: z.uuid(),
  id: z.uuid(),
  number: z.coerce.number().int().min(1),
});

/** `PATCH /debts/:id/completion-date`: nova data de entrega das chaves. @see RN 6.7 */
export const completionDateBodySchema = z.object({ completionDate: isoDateSchema });

/** `POST /debts/:id/phases/:phaseId/values`: valor real do mês numa fase variável. @see RN 6.1 */
export const phaseValueBodySchema = z.object({ month: yearMonth, amount: z.int().min(0) });

export const debtPhaseParamsSchema = z.object({
  spaceId: z.uuid(),
  id: z.uuid(),
  phaseId: z.uuid(),
});

/** `POST /index-values`: índice do mês (0.0045 = 0,45%). @see RN 6.2 */
export const indexValueBodySchema = z.object({
  index: z.enum(['incc', 'ipca', 'igpm']),
  month: yearMonth,
  value: z.number().gt(-1).lt(1),
});
export type IndexValueBody = z.infer<typeof indexValueBodySchema>;

export const indexValueSchema = indexValueBodySchema;
export type IndexValue = z.infer<typeof indexValueSchema>;

/**
 * `POST /debts/:id/phases/:phaseId/index`: aplica o índice do mês (cadastrado em
 * `/index-values`) às parcelas pendentes da fase que vencem a partir desse mês.
 * @see RN 6.2
 */
export const applyIndexBodySchema = z.object({ month: yearMonth });
