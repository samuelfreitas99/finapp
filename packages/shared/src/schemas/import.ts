import { z } from 'zod';
import { isoDateSchema } from './common';

/** Tamanho máximo do texto de um extrato (2 MB). */
export const IMPORT_MAX_CHARS = 2_000_000;

const yearMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'mês no formato AAAA-MM');

/**
 * Destino da importação: extrato de **conta** (`accountId`) ou fatura de **cartão**
 * (`cardId` + `invoiceMonth`, o mês de vencimento da fatura).
 */
const importTarget = {
  accountId: z.uuid().optional(),
  cardId: z.uuid().optional(),
  invoiceMonth: yearMonth.optional(),
};
const oneTarget = (b: {
  accountId?: string | undefined;
  cardId?: string | undefined;
  invoiceMonth?: string | undefined;
}) => Boolean(b.accountId) !== Boolean(b.cardId) && (!b.cardId || Boolean(b.invoiceMonth));
const oneTargetMessage = {
  message: 'informe a conta ou o cartão com o mês da fatura',
  path: ['accountId'],
};

export const importPreviewBodySchema = z
  .object({
    ...importTarget,
    format: z.enum(['ofx', 'csv']),
    /** Conteúdo do arquivo como texto. */
    content: z.string().min(1).max(IMPORT_MAX_CHARS),
    /** CSV em que a saída aparece como valor positivo (comum em fatura de cartão). */
    invert: z.boolean().default(false),
  })
  .refine(oneTarget, oneTargetMessage);
export type ImportPreviewBody = z.input<typeof importPreviewBodySchema>;

export const importRowSchema = z.object({
  date: isoDateSchema,
  type: z.enum(['income', 'expense']),
  /** Valor positivo; o tipo dá o sentido. */
  amount: z.int().positive(),
  description: z.string(),
  importKey: z.string(),
  /** `exact`: já importado; `possible`: valor igual por perto (talvez lançado à mão). */
  duplicate: z.enum(['exact', 'possible']).nullable(),
  /** Categoria sugerida por uma regra. */
  categoryId: z.uuid().nullable(),
  beforeInitialDate: z.boolean(),
  /** Fatura: linha do pagamento da fatura anterior (já lançado pela conta; não importa). */
  invoicePayment: z.boolean(),
  /**
   * Lançamento da conta que é este item: `planned` = previsto a confirmar (salário, conta
   * fixa, parcela); `settled` = lançado à mão (só liga ao extrato, não cria outro).
   */
  match: z
    .object({
      id: z.uuid(),
      kind: z.enum(['planned', 'settled']),
      description: z.string(),
      date: isoDateSchema,
      amount: z.int(),
    })
    .nullable(),
});
export type ImportRow = z.infer<typeof importRowSchema>;

export const importPreviewSchema = z.object({
  rows: z.array(importRowSchema),
  counts: z.object({
    total: z.int(),
    exact: z.int(),
    possible: z.int(),
    ready: z.int(),
    /** Itens que confirmam um previsto ou ligam um lançamento já feito. */
    matched: z.int(),
  }),
});
export type ImportPreview = z.infer<typeof importPreviewSchema>;

export const importCommitBodySchema = z
  .object({
    ...importTarget,
    items: z
      .array(
        z.object({
          date: isoDateSchema,
          type: z.enum(['income', 'expense']),
          amount: z.int().positive(),
          description: z.string().trim().min(1).max(300),
          importKey: z.string().min(1).max(300),
          categoryId: z.uuid().nullish(),
          /** Cria uma regra com o trecho da descrição para a categoria escolhida. */
          saveRule: z.boolean().default(false),
          /** Lançamento existente que é este item (ver `match` na prévia): não cria outro. */
          matchId: z.uuid().nullish(),
        }),
      )
      .min(1)
      .max(2000),
    /**
     * Conta: importar também os itens de antes do início da conta. O início recua para o
     * item mais antigo e o saldo inicial é recalculado para o saldo de hoje não mudar.
     */
    extendStart: z.boolean().default(false),
  })
  .refine(oneTarget, oneTargetMessage);

export type ImportCommitBody = z.input<typeof importCommitBodySchema>;

export const importResultSchema = z.object({
  created: z.int(),
  /** Previstos confirmados pelo extrato. */
  confirmed: z.int(),
  /** Lançamentos feitos à mão ligados ao extrato (não duplicados). */
  linked: z.int(),
  skipped: z.int(),
  rulesCreated: z.int(),
  /** Novo início da conta, quando `extendStart` recuou a data. */
  newInitialDate: isoDateSchema.nullable(),
});
export type ImportResult = z.infer<typeof importResultSchema>;

export const categoryRuleBodySchema = z.object({
  pattern: z.string().trim().min(2).max(80),
  categoryId: z.uuid(),
});
export type CategoryRuleBody = z.infer<typeof categoryRuleBodySchema>;

export const categoryRuleSchema = z.object({
  id: z.uuid(),
  pattern: z.string(),
  categoryId: z.uuid(),
  categoryName: z.string(),
});
export type CategoryRule = z.infer<typeof categoryRuleSchema>;
