import { z } from 'zod';
import { isoDateSchema } from './common';

/** Tamanho máximo do texto de um extrato (2 MB). */
export const IMPORT_MAX_CHARS = 2_000_000;

export const importPreviewBodySchema = z.object({
  accountId: z.uuid(),
  format: z.enum(['ofx', 'csv']),
  /** Conteúdo do arquivo como texto. */
  content: z.string().min(1).max(IMPORT_MAX_CHARS),
  /** CSV em que a saída aparece como valor positivo. */
  invert: z.boolean().default(false),
});
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
});
export type ImportRow = z.infer<typeof importRowSchema>;

export const importPreviewSchema = z.object({
  rows: z.array(importRowSchema),
  counts: z.object({ total: z.int(), exact: z.int(), possible: z.int(), ready: z.int() }),
});
export type ImportPreview = z.infer<typeof importPreviewSchema>;

export const importCommitBodySchema = z.object({
  accountId: z.uuid(),
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
      }),
    )
    .min(1)
    .max(2000),
});
export type ImportCommitBody = z.input<typeof importCommitBodySchema>;

export const importResultSchema = z.object({
  created: z.int(),
  skipped: z.int(),
  rulesCreated: z.int(),
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
