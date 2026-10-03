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

export const RECURRENCE_FREQUENCIES = ['monthly', 'weekly', 'yearly', 'every_n_months'] as const;
export type RecurrenceFrequency = (typeof RECURRENCE_FREQUENCIES)[number];

export const BUSINESS_DAY_ADJUSTS = ['none', 'previous', 'next'] as const;
export type BusinessDayAdjustValue = (typeof BUSINESS_DAY_ADJUSTS)[number];

/** Dívidas e empréstimos (RN 6). */
export const DEBT_DIRECTIONS = ['i_owe', 'owed_to_me'] as const;
export type DebtDirection = (typeof DEBT_DIRECTIONS)[number];

export const DEBT_KINDS = [
  'bank_loan',
  'card_loan',
  'personal_loan',
  'third_party_card',
  'financing',
  'agreement',
  'consortium',
  'property',
  'other',
] as const;
export type DebtKind = (typeof DEBT_KINDS)[number];

export const DEBT_STATUSES = ['active', 'paid_off', 'cancelled'] as const;
export type DebtStatus = (typeof DEBT_STATUSES)[number];

export const DEBT_SYSTEMS = ['fixed', 'price', 'sac', 'variable', 'balloon'] as const;
export type DebtSystem = (typeof DEBT_SYSTEMS)[number];

export const DEBT_INDEXES = ['none', 'incc', 'ipca', 'igpm'] as const;
export type DebtIndex = (typeof DEBT_INDEXES)[number];

export const DEBT_INSTALLMENT_STATUSES = ['pending', 'paid', 'late', 'partial'] as const;
export type DebtInstallmentStatus = (typeof DEBT_INSTALLMENT_STATUSES)[number];

/** Passos do "primeiros passos" do Início, na ordem em que aparecem. */
export const ONBOARDING_STEPS = [
  'account',
  'card',
  'income',
  'expenses',
  'debts',
  'notifications',
] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export const DEBT_EVENT_TYPES = [
  'amortization',
  'payoff',
  'index_correction',
  'completion_date_change',
] as const;
export type DebtEventType = (typeof DEBT_EVENT_TYPES)[number];

/** Tipos de alerta (RN 9). */
export const NOTIFICATION_TYPES = [
  'due_soon',
  'overdue',
  'invoice_closing',
  'invoice_closed',
  'invoice_due',
  'income_unconfirmed',
  'negative_forecast',
  'budget',
  'card_limit',
  'split_pending',
  'reminder',
  'weekly_summary',
  'monthly_summary',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** Avisos que começam desligados (resumos): o usuário liga em Configurações. */
export const OFF_BY_DEFAULT_NOTIFICATIONS: readonly NotificationType[] = [
  'weekly_summary',
  'monthly_summary',
];

export const REMINDER_REPEATS = ['none', 'daily', 'weekly', 'monthly', 'yearly'] as const;
export type ReminderRepeat = (typeof REMINDER_REPEATS)[number];
