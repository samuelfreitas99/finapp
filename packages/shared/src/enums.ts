/**
 * Valores aceitos nas colunas "enum" do banco (text + check constraint).
 * Fonte única para o schema Drizzle, os schemas Zod e o front.
 * @see docs/modelo-de-dados.md
 */

export const SPACE_TYPES = ['personal', 'shared'] as const;
export type SpaceType = (typeof SPACE_TYPES)[number];

export const SPACE_ROLES = ['owner', 'member'] as const;
export type SpaceRole = (typeof SPACE_ROLES)[number];

export const THEMES = ['system', 'light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

export const ACCOUNT_TYPES = [
  'checking',
  'savings',
  'cash',
  'investment',
  'benefit',
  'wallet',
] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const CATEGORY_KINDS = ['income', 'expense'] as const;
export type CategoryKind = (typeof CATEGORY_KINDS)[number];

/** Categorias técnicas criadas pelo sistema (fora dos relatórios de gasto/renda). */
export const SYSTEM_CATEGORY_KEYS = ['invoice_payment', 'adjustment', 'transfer', 'loan'] as const;
export type SystemCategoryKey = (typeof SYSTEM_CATEGORY_KEYS)[number];

export const TRANSACTION_TYPES = [
  'income',
  'expense',
  'transfer_in',
  'transfer_out',
  'adjustment',
] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export const TRANSACTION_STATUSES = ['planned', 'settled'] as const;
export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];

export const PAYMENT_METHODS = [
  'pix',
  'debit',
  'credit',
  'cash',
  'boleto',
  'ted',
  'other',
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const CARD_BRANDS = ['visa', 'mastercard', 'elo', 'amex', 'hipercard', 'other'] as const;
export type CardBrand = (typeof CARD_BRANDS)[number];

/** Estados da fatura (RN 4). `open` até o fechamento; depois `closed`, `paid`, `partial` ou `overdue`. */
export const INVOICE_STATUSES = ['open', 'closed', 'paid', 'partial', 'overdue'] as const;
export type InvoiceStatusValue = (typeof INVOICE_STATUSES)[number];

export const INSTALLMENT_PLAN_STATUSES = ['active', 'finished', 'cancelled'] as const;
export type InstallmentPlanStatus = (typeof INSTALLMENT_PLAN_STATUSES)[number];
