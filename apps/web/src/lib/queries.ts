import type {
  Account,
  NotificationDto,
  AdvanceBody,
  AmortizeBody,
  PayInstallmentBody,
  PayoffBody,
  Debt,
  DebtBody,
  DebtDetail,
  DebtPreview,
  UpdateDebtBody,
  Projection,
  Attachment,
  SimulatePayoff,
  IndexValue,
  GoalDeposit,
  CreateCategoryBody,
  UpdateCategoryBody,
  GroupLink,
  GroupLinkBody,
  SyncResult,
  GroupDetail,
  GroupExpenseBody,
  GroupSettlementBody,
  GroupSummary,
  CoupleBalance,
  CoupleSplit,
  CoupleSplitBody,
  SettlementBody,
  SplitSettings,
  SplitSettingsBody,
  Consolidated,
  Invite,
  SpaceMember,
  SpaceSummary,
  AuditItem,
  CategoryRule,
  ImportCommitBody,
  ImportPreview,
  ImportPreviewBody,
  ImportResult,
  Budgets,
  ByCategoryReport,
  MonthlyReport,
  NetWorthReport,
  Goal,
  CreateGoalBody,
  UpdateGoalBody,
  GoalDepositBody,
  UpsertBudgetBody,
  OccurrencePreview,
  Recurrence,
  RecurrenceBody,
  UpdateRecurrenceBody,
  Card,
  CreateCardBody,
  InstallmentPlan,
  InstallmentPlanBody,
  InstallmentPlanDetail,
  InstallmentPreview,
  InvoiceDetail,
  PayInvoiceBody,
  UpdateCardBody,
  Category,
  CreateAccountBody,
  CreateAdjustmentBody,
  createTransactionBodySchema,
  Dashboard,
  createTransferBodySchema,
  SettleTransactionBody,
  Transaction,
  TransactionList,
  UpdateAccountBody,
  UpdateTransactionBody,
} from '@finapp/shared';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod';
import { useActiveSpace } from '../auth/session';
import { api, spacePath, uploadFile } from './api';

/** Espaço ativo; as telas logadas sempre têm um. */
export function useSpaceId(): string {
  const space = useActiveSpace();
  if (!space) throw new Error('sem espaço ativo');
  return space.id;
}

export const keys = {
  accounts: (spaceId: string) => ['accounts', spaceId] as const,
  categories: (spaceId: string) => ['categories', spaceId] as const,
  transactions: (spaceId: string) => ['transactions', spaceId] as const,
};

/** Depois de mexer em lançamentos ou contas, saldos e listas mudam juntos. */
function useInvalidateMoney() {
  const qc = useQueryClient();
  const spaceId = useSpaceId();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: keys.accounts(spaceId) }),
      qc.invalidateQueries({ queryKey: keys.transactions(spaceId) }),
    ]);
}

export function useAccounts({ includeArchived = false } = {}) {
  const spaceId = useSpaceId();
  return useQuery({
    queryKey: [...keys.accounts(spaceId), { includeArchived }],
    queryFn: () =>
      api<{ items: Account[] }>(
        spacePath(spaceId, `/accounts${includeArchived ? '?includeArchived=true' : ''}`),
      ).then((r) => r.items),
  });
}

export function useAccount(id: string | undefined) {
  const spaceId = useSpaceId();
  return useQuery({
    queryKey: [...keys.accounts(spaceId), id],
    queryFn: () => api<Account>(spacePath(spaceId, `/accounts/${id}`)),
    enabled: Boolean(id),
  });
}

export function useCreateAccount() {
  const spaceId = useSpaceId();
  const invalidate = useInvalidateMoney();
  return useMutation({
    mutationFn: (body: CreateAccountBody) =>
      api<Account>(spacePath(spaceId, '/accounts'), { method: 'POST', body }),
    onSuccess: invalidate,
  });
}

export function useUpdateAccount(id: string) {
  const spaceId = useSpaceId();
  const invalidate = useInvalidateMoney();
  return useMutation({
    mutationFn: (body: UpdateAccountBody) =>
      api<Account>(spacePath(spaceId, `/accounts/${id}`), { method: 'PATCH', body }),
    onSuccess: invalidate,
  });
}

export function useDeleteAccount(id: string) {
  const spaceId = useSpaceId();
  const invalidate = useInvalidateMoney();
  return useMutation({
    mutationFn: () => api<undefined>(spacePath(spaceId, `/accounts/${id}`), { method: 'DELETE' }),
    onSuccess: invalidate,
  });
}

export function useAdjustBalance() {
  const spaceId = useSpaceId();
  const invalidate = useInvalidateMoney();
  return useMutation({
    mutationFn: (
      body: Partial<CreateAdjustmentBody> & { accountId: string; realBalance: number },
    ) =>
      api<{ adjustment: Transaction | null; balance: number }>(spacePath(spaceId, '/adjustments'), {
        method: 'POST',
        body,
      }),
    onSuccess: invalidate,
  });
}

export function useCategories() {
  const spaceId = useSpaceId();
  return useQuery({
    queryKey: keys.categories(spaceId),
    queryFn: () =>
      api<{ items: Category[] }>(spacePath(spaceId, '/categories?includeSystem=true')).then(
        (r) => r.items,
      ),
    staleTime: 5 * 60_000,
  });
}

export interface TransactionFilters {
  from?: string;
  to?: string;
  accountId?: string;
  cardId?: string;
  categoryId?: string;
  type?: string;
  status?: string;
  q?: string;
}

export function useTransactions(filters: TransactionFilters) {
  const spaceId = useSpaceId();
  return useInfiniteQuery({
    queryKey: [...keys.transactions(spaceId), 'list', filters],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(filters)) if (v) params.set(k, v);
      params.set('limit', '100');
      if (pageParam) params.set('cursor', pageParam);
      return api<TransactionList>(spacePath(spaceId, `/transactions?${params}`));
    },
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function useTransaction(id: string | undefined) {
  const spaceId = useSpaceId();
  return useQuery({
    queryKey: [...keys.transactions(spaceId), 'one', id],
    queryFn: () => api<Transaction>(spacePath(spaceId, `/transactions/${id}`)),
    enabled: Boolean(id),
  });
}

export function useCreateTransaction() {
  const spaceId = useSpaceId();
  const invalidate = useInvalidateMoney();
  return useMutation({
    mutationFn: (body: z.input<typeof createTransactionBodySchema>) =>
      api<Transaction>(spacePath(spaceId, '/transactions'), { method: 'POST', body }),
    onSuccess: invalidate,
  });
}

export function useCreateTransfer() {
  const spaceId = useSpaceId();
  const invalidate = useInvalidateMoney();
  return useMutation({
    mutationFn: (body: z.input<typeof createTransferBodySchema>) =>
      api<{ transferId: string; items: Transaction[] }>(spacePath(spaceId, '/transfers'), {
        method: 'POST',
        body,
      }),
    onSuccess: invalidate,
  });
}

export function useUpdateTransaction(id: string) {
  const spaceId = useSpaceId();
  const invalidate = useInvalidateMoney();
  return useMutation({
    mutationFn: (body: UpdateTransactionBody) =>
      api<Transaction>(spacePath(spaceId, `/transactions/${id}`), { method: 'PATCH', body }),
    onSuccess: invalidate,
  });
}

export function useDeleteTransaction() {
  const spaceId = useSpaceId();
  const invalidate = useInvalidateMoney();
  return useMutation({
    mutationFn: (id: string) =>
      api<undefined>(spacePath(spaceId, `/transactions/${id}`), { method: 'DELETE' }),
    onSuccess: invalidate,
  });
}

export function useSettleTransaction() {
  const spaceId = useSpaceId();
  const invalidate = useInvalidateMoney();
  return useMutation({
    mutationFn: ({ id, ...body }: SettleTransactionBody & { id: string }) =>
      api<Transaction>(spacePath(spaceId, `/transactions/${id}/settle`), { method: 'POST', body }),
    onSuccess: invalidate,
  });
}

export function useDashboard() {
  const spaceId = useSpaceId();
  return useQuery({
    queryKey: [...keys.transactions(spaceId), 'dashboard'],
    queryFn: () => api<Dashboard>(spacePath(spaceId, '/dashboard')),
  });
}

export const cardKeys = {
  all: (spaceId: string) => ['cards', spaceId] as const,
  plans: (spaceId: string) => ['installment-plans', spaceId] as const,
};

/** Mexer em cartão, fatura ou parcelamento muda saldos, listas e limites. */
function useInvalidateCards() {
  const qc = useQueryClient();
  const spaceId = useSpaceId();
  const money = useInvalidateMoney();
  return () =>
    Promise.all([
      money(),
      qc.invalidateQueries({ queryKey: cardKeys.all(spaceId) }),
      qc.invalidateQueries({ queryKey: cardKeys.plans(spaceId) }),
    ]);
}

export function useCards({ includeArchived = false } = {}) {
  const spaceId = useSpaceId();
  return useQuery({
    queryKey: [...cardKeys.all(spaceId), 'list', { includeArchived }],
    queryFn: () =>
      api<{ items: Card[] }>(
        spacePath(spaceId, `/cards${includeArchived ? '?includeArchived=true' : ''}`),
      ).then((r) => r.items),
  });
}

export function useCard(id: string | undefined) {
  const spaceId = useSpaceId();
  return useQuery({
    queryKey: [...cardKeys.all(spaceId), id],
    queryFn: () => api<Card>(spacePath(spaceId, `/cards/${id}`)),
    enabled: Boolean(id),
  });
}

export function useSaveCard(id?: string) {
  const spaceId = useSpaceId();
  const invalidate = useInvalidateCards();
  return useMutation({
    mutationFn: (body: CreateCardBody | UpdateCardBody) =>
      id
        ? api<Card>(spacePath(spaceId, `/cards/${id}`), { method: 'PATCH', body })
        : api<Card>(spacePath(spaceId, '/cards'), { method: 'POST', body }),
    onSuccess: invalidate,
  });
}

export function useDeleteCard(id: string) {
  const spaceId = useSpaceId();
  const invalidate = useInvalidateCards();
  return useMutation({
    mutationFn: () => api<undefined>(spacePath(spaceId, `/cards/${id}`), { method: 'DELETE' }),
    onSuccess: invalidate,
  });
}

export function useInvoice(cardId: string | undefined, month: string | undefined) {
  const spaceId = useSpaceId();
  return useQuery({
    queryKey: [...cardKeys.all(spaceId), cardId, 'invoice', month],
    queryFn: () => api<InvoiceDetail>(spacePath(spaceId, `/cards/${cardId}/invoices/${month}`)),
    enabled: Boolean(cardId && month),
  });
}

export function usePayInvoice(cardId: string, month: string) {
  const spaceId = useSpaceId();
  const invalidate = useInvalidateCards();
  return useMutation({
    mutationFn: (body: PayInvoiceBody) =>
      api<InvoiceDetail>(spacePath(spaceId, `/cards/${cardId}/invoices/${month}/payments`), {
        method: 'POST',
        body,
      }),
    onSuccess: invalidate,
  });
}

export function useUndoPayment(cardId: string, month: string) {
  const spaceId = useSpaceId();
  const invalidate = useInvalidateCards();
  return useMutation({
    mutationFn: (paymentId: string) =>
      api<InvoiceDetail>(
        spacePath(spaceId, `/cards/${cardId}/invoices/${month}/payments/${paymentId}`),
        { method: 'DELETE' },
      ),
    onSuccess: invalidate,
  });
}

export function useInstallmentPlans(
  filters: { status?: string | undefined; cardId?: string | undefined } = {},
) {
  const spaceId = useSpaceId();
  return useQuery({
    queryKey: [...cardKeys.plans(spaceId), filters],
    queryFn: () => {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(filters)) if (v) params.set(k, v);
      return api<{ items: InstallmentPlan[] }>(
        spacePath(spaceId, `/installment-plans?${params}`),
      ).then((r) => r.items);
    },
  });
}

export function useInstallmentPlan(id: string | undefined) {
  const spaceId = useSpaceId();
  return useQuery({
    queryKey: [...cardKeys.plans(spaceId), 'one', id],
    queryFn: () => api<InstallmentPlanDetail>(spacePath(spaceId, `/installment-plans/${id}`)),
    enabled: Boolean(id),
  });
}

export function useInstallmentPreview(body: InstallmentPlanBody | null) {
  const spaceId = useSpaceId();
  return useQuery({
    queryKey: [...cardKeys.plans(spaceId), 'preview', body],
    queryFn: () =>
      api<InstallmentPreview>(spacePath(spaceId, '/installment-plans/preview'), {
        method: 'POST',
        body,
      }),
    enabled: body !== null,
    staleTime: 60_000,
  });
}

export function useCreatePlan() {
  const spaceId = useSpaceId();
  const invalidate = useInvalidateCards();
  return useMutation({
    mutationFn: (body: InstallmentPlanBody) =>
      api<InstallmentPlanDetail>(spacePath(spaceId, '/installment-plans'), {
        method: 'POST',
        body,
      }),
    onSuccess: invalidate,
  });
}

export function usePlanAction(id: string) {
  const spaceId = useSpaceId();
  const invalidate = useInvalidateCards();
  return useMutation({
    mutationFn: ({ action, body }: { action: 'anticipate' | 'cancel'; body: unknown }) =>
      api<InstallmentPlanDetail & { discount?: number }>(
        spacePath(spaceId, `/installment-plans/${id}/${action}`),
        { method: 'POST', body },
      ),
    onSuccess: invalidate,
  });
}

export const recurrenceKeys = (spaceId: string) => ['recurrences', spaceId] as const;

export function useRecurrences() {
  const spaceId = useSpaceId();
  return useQuery({
    queryKey: recurrenceKeys(spaceId),
    queryFn: () =>
      api<{ items: Recurrence[] }>(spacePath(spaceId, '/recurrences')).then((r) => r.items),
  });
}

export function useRecurrence(id: string | undefined) {
  const spaceId = useSpaceId();
  return useQuery({
    queryKey: [...recurrenceKeys(spaceId), id],
    queryFn: () => api<Recurrence>(spacePath(spaceId, `/recurrences/${id}`)),
    enabled: Boolean(id),
  });
}

export function useRecurrencePreview(body: RecurrenceBody | null) {
  const spaceId = useSpaceId();
  return useQuery({
    queryKey: [...recurrenceKeys(spaceId), 'preview', body],
    queryFn: () =>
      api<{ items: OccurrencePreview[] }>(spacePath(spaceId, '/recurrences/preview?months=12'), {
        method: 'POST',
        body,
      }).then((r) => r.items),
    enabled: body !== null,
    staleTime: 60_000,
    retry: false,
  });
}

/** Criar, editar ("a partir de") e encerrar recorrências mexe em listas, saldos e faturas. */
export function useRecurrenceMutations() {
  const spaceId = useSpaceId();
  const qc = useQueryClient();
  const money = useInvalidateMoney();
  const invalidate = () =>
    Promise.all([
      money(),
      qc.invalidateQueries({ queryKey: recurrenceKeys(spaceId) }),
      qc.invalidateQueries({ queryKey: cardKeys.all(spaceId) }),
    ]);
  return {
    create: useMutation({
      mutationFn: (body: RecurrenceBody) =>
        api<Recurrence>(spacePath(spaceId, '/recurrences'), { method: 'POST', body }),
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, from, body }: { id: string; from?: string; body: UpdateRecurrenceBody }) =>
        api<Recurrence>(spacePath(spaceId, `/recurrences/${id}${from ? `?from=${from}` : ''}`), {
          method: 'PATCH',
          body,
        }),
      onSuccess: invalidate,
    }),
    end: useMutation({
      mutationFn: (id: string) =>
        api<undefined>(spacePath(spaceId, `/recurrences/${id}`), { method: 'DELETE' }),
      onSuccess: invalidate,
    }),
  };
}

export function useProjection(months: number) {
  const spaceId = useSpaceId();
  return useQuery({
    queryKey: [...keys.transactions(spaceId), 'projection', months],
    queryFn: () => api<Projection>(spacePath(spaceId, `/projection?months=${months}`)),
  });
}

export const debtKeys = (spaceId: string) => ['debts', spaceId] as const;

export function useDebts() {
  const spaceId = useSpaceId();
  return useQuery({
    queryKey: debtKeys(spaceId),
    queryFn: () => api<{ items: Debt[] }>(spacePath(spaceId, '/debts')).then((r) => r.items),
  });
}

export function useDebt(id: string | undefined) {
  const spaceId = useSpaceId();
  return useQuery({
    queryKey: [...debtKeys(spaceId), id],
    queryFn: () => api<DebtDetail>(spacePath(spaceId, `/debts/${id}`)),
    enabled: Boolean(id),
  });
}

export function useDebtPreview(body: DebtBody | null) {
  const spaceId = useSpaceId();
  return useQuery({
    queryKey: [...debtKeys(spaceId), 'preview', body],
    queryFn: () => api<DebtPreview>(spacePath(spaceId, '/debts/preview'), { method: 'POST', body }),
    enabled: body !== null,
    staleTime: 60_000,
    retry: false,
  });
}

/** Mexer em dívidas muda saldos previstos, faturas e a projeção. */
export function useDebtMutations() {
  const spaceId = useSpaceId();
  const qc = useQueryClient();
  const money = useInvalidateMoney();
  const invalidate = () =>
    Promise.all([
      money(),
      qc.invalidateQueries({ queryKey: debtKeys(spaceId) }),
      qc.invalidateQueries({ queryKey: cardKeys.all(spaceId) }),
    ]);
  return {
    create: useMutation({
      mutationFn: (body: DebtBody) =>
        api<DebtDetail>(spacePath(spaceId, '/debts'), { method: 'POST', body }),
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, body }: { id: string; body: UpdateDebtBody }) =>
        api<DebtDetail>(spacePath(spaceId, `/debts/${id}`), { method: 'PATCH', body }),
      onSuccess: invalidate,
    }),
    cancel: useMutation({
      mutationFn: (id: string) =>
        api<undefined>(spacePath(spaceId, `/debts/${id}`), { method: 'DELETE' }),
      onSuccess: invalidate,
    }),
    invalidate,
  };
}

export function useDebtActions(id: string) {
  const spaceId = useSpaceId();
  const { invalidate } = useDebtMutations();
  const post = (path: string, body: unknown) =>
    api<DebtDetail>(spacePath(spaceId, `/debts/${id}${path}`), { method: 'POST', body });
  return {
    pay: useMutation({
      mutationFn: ({ number, ...body }: PayInstallmentBody & { number: number }) =>
        post(`/installments/${number}/pay`, body),
      onSuccess: invalidate,
    }),
    advance: useMutation({
      mutationFn: (body: AdvanceBody) => post('/advance', body),
      onSuccess: invalidate,
    }),
    amortize: useMutation({
      mutationFn: (body: AmortizeBody) => post('/amortize', body),
      onSuccess: invalidate,
    }),
    payoff: useMutation({
      mutationFn: (body: PayoffBody) => post('/payoff', body),
      onSuccess: invalidate,
    }),
  };
}

export function usePropertyActions(id: string) {
  const spaceId = useSpaceId();
  const { invalidate } = useDebtMutations();
  return {
    completion: useMutation({
      mutationFn: ({
        completionDate,
        confirmed = false,
      }: {
        completionDate: string;
        confirmed?: boolean;
      }) =>
        api<DebtDetail>(spacePath(spaceId, `/debts/${id}/completion-date`), {
          method: 'PATCH',
          body: { completionDate, confirmed },
        }),
      onSuccess: invalidate,
    }),
    value: useMutation({
      mutationFn: ({
        phaseId,
        month,
        amount,
      }: {
        phaseId: string;
        month: string;
        amount: number;
      }) =>
        api<DebtDetail>(spacePath(spaceId, `/debts/${id}/phases/${phaseId}/values`), {
          method: 'POST',
          body: { month, amount },
        }),
      onSuccess: invalidate,
    }),
    index: useMutation({
      mutationFn: async ({
        phaseId,
        index,
        month,
        value,
      }: {
        phaseId: string;
        index: 'incc' | 'ipca' | 'igpm';
        month: string;
        value: number;
      }) => {
        await api(spacePath(spaceId, '/index-values'), {
          method: 'POST',
          body: { index, month, value },
        });
        return api<DebtDetail>(spacePath(spaceId, `/debts/${id}/phases/${phaseId}/index`), {
          method: 'POST',
          body: { month },
        });
      },
      onSuccess: invalidate,
    }),
  };
}

export function useNotifications() {
  return useQuery({
    queryKey: ['notifications'],
    queryFn: () => api<{ items: NotificationDto[]; unread: number }>('/api/notifications'),
    refetchInterval: 5 * 60_000,
  });
}

export function useNotificationActions() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['notifications'] });
  return {
    read: useMutation({
      mutationFn: (id: string) =>
        api(`/api/notifications/${id}/read`, { method: 'POST', body: {} }),
      onSuccess: invalidate,
    }),
    readAll: useMutation({
      mutationFn: () => api('/api/notifications/read-all', { method: 'POST', body: {} }),
      onSuccess: invalidate,
    }),
  };
}

export function useBudgets(month: string) {
  const spaceId = useSpaceId();
  return useQuery({
    queryKey: ['budgets', spaceId, month],
    queryFn: () => api<Budgets>(spacePath(spaceId, `/budgets?month=${month}`)),
  });
}

export function useBudgetMutations() {
  const spaceId = useSpaceId();
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['budgets', spaceId] });
  return {
    save: useMutation({
      mutationFn: (body: UpsertBudgetBody) =>
        api(spacePath(spaceId, '/budgets'), { method: 'PUT', body }),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: string) => api(spacePath(spaceId, `/budgets/${id}`), { method: 'DELETE' }),
      onSuccess: invalidate,
    }),
  };
}

export function useGoals() {
  const spaceId = useSpaceId();
  return useQuery({
    queryKey: ['goals', spaceId],
    queryFn: () => api<{ items: Goal[] }>(spacePath(spaceId, '/goals')).then((r) => r.items),
  });
}

export function useGoalMutations() {
  const spaceId = useSpaceId();
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['goals', spaceId] });
  return {
    create: useMutation({
      mutationFn: (body: CreateGoalBody) =>
        api<Goal>(spacePath(spaceId, '/goals'), { method: 'POST', body }),
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, ...body }: UpdateGoalBody & { id: string }) =>
        api<Goal>(spacePath(spaceId, `/goals/${id}`), { method: 'PATCH', body }),
      onSuccess: invalidate,
    }),
    deposit: useMutation({
      mutationFn: ({ id, ...body }: GoalDepositBody & { id: string }) =>
        api<Goal>(spacePath(spaceId, `/goals/${id}/deposit`), { method: 'POST', body }),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: string) => api(spacePath(spaceId, `/goals/${id}`), { method: 'DELETE' }),
      onSuccess: invalidate,
    }),
    undoDeposit: useMutation({
      mutationFn: ({ goalId, depositId }: { goalId: string; depositId: string }) =>
        api(spacePath(spaceId, `/goals/${goalId}/deposits/${depositId}`), { method: 'DELETE' }),
      onSuccess: () => qc.invalidateQueries({ queryKey: ['goals', spaceId] }),
    }),
  };
}

export function useGoalDeposits(goalId: string, enabled: boolean) {
  const spaceId = useSpaceId();
  return useQuery({
    queryKey: ['goals', spaceId, 'deposits', goalId],
    queryFn: () =>
      api<{ items: GoalDeposit[] }>(spacePath(spaceId, `/goals/${goalId}/deposits`)).then(
        (r) => r.items,
      ),
    enabled,
  });
}

export function useReportByCategory(from: string, to: string, kind: 'expense' | 'income') {
  const spaceId = useSpaceId();
  return useQuery({
    queryKey: ['reports', spaceId, 'by-category', from, to, kind],
    queryFn: () =>
      api<ByCategoryReport>(
        spacePath(spaceId, `/reports/by-category?from=${from}&to=${to}&kind=${kind}`),
      ),
  });
}

export function useReportMonthly(months: number) {
  const spaceId = useSpaceId();
  return useQuery({
    queryKey: ['reports', spaceId, 'monthly', months],
    queryFn: () => api<MonthlyReport>(spacePath(spaceId, `/reports/monthly?months=${months}`)),
  });
}

export function useReportNetWorth() {
  const spaceId = useSpaceId();
  return useQuery({
    queryKey: ['reports', spaceId, 'net-worth'],
    queryFn: () => api<NetWorthReport>(spacePath(spaceId, '/reports/net-worth')),
  });
}

export function useAttachments(transactionId: string) {
  const spaceId = useSpaceId();
  return useQuery({
    queryKey: ['attachments', spaceId, transactionId],
    queryFn: () =>
      api<{ items: Attachment[] }>(
        spacePath(spaceId, `/transactions/${transactionId}/attachments`),
      ).then((r) => r.items),
  });
}

export function useAttachmentMutations(transactionId: string) {
  const spaceId = useSpaceId();
  const qc = useQueryClient();
  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ['attachments', spaceId, transactionId] });
  return {
    upload: useMutation({
      mutationFn: ({ file, name }: { file: Blob; name: string }) =>
        uploadFile<Attachment>(
          spacePath(spaceId, `/transactions/${transactionId}/attachments`),
          file,
          name,
        ),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: string) =>
        api(spacePath(spaceId, `/attachments/${id}`), { method: 'DELETE' }),
      onSuccess: invalidate,
    }),
  };
}

export function useImport() {
  const spaceId = useSpaceId();
  const qc = useQueryClient();
  return {
    preview: useMutation({
      mutationFn: (body: ImportPreviewBody) =>
        api<ImportPreview>(spacePath(spaceId, '/import/preview'), { method: 'POST', body }),
    }),
    commit: useMutation({
      mutationFn: (body: ImportCommitBody) =>
        api<ImportResult>(spacePath(spaceId, '/import/commit'), { method: 'POST', body }),
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: keys.accounts(spaceId) });
        void qc.invalidateQueries({ queryKey: keys.transactions(spaceId) });
        void qc.invalidateQueries({ queryKey: ['category-rules', spaceId] });
        // Fatura importada, previstos confirmados (parcelas de dívida, recorrências).
        void qc.invalidateQueries({ queryKey: cardKeys.all(spaceId) });
        void qc.invalidateQueries({ queryKey: debtKeys(spaceId) });
      },
    }),
  };
}

export function useCategoryRules() {
  const spaceId = useSpaceId();
  return useQuery({
    queryKey: ['category-rules', spaceId],
    queryFn: () =>
      api<{ items: CategoryRule[] }>(spacePath(spaceId, '/category-rules')).then((r) => r.items),
  });
}

export function useDeleteCategoryRule() {
  const spaceId = useSpaceId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api(spacePath(spaceId, `/category-rules/${id}`), { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['category-rules', spaceId] }),
  });
}

export function useAuditLog() {
  const spaceId = useSpaceId();
  return useInfiniteQuery({
    queryKey: ['audit-log', spaceId],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api<{ items: AuditItem[]; nextCursor: string | null }>(
        spacePath(spaceId, `/audit-log?limit=30${pageParam ? `&cursor=${pageParam}` : ''}`),
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

/** Troca o espaço ativo e refaz todas as consultas (cada uma é por espaço). */
export function useSwitchSpace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (spaceId: string) =>
      api('/api/me/active-space', { method: 'PUT', body: { spaceId } }),
    onSuccess: () => qc.invalidateQueries(),
  });
}

export function useConsolidated(enabled: boolean) {
  return useQuery({
    queryKey: ['consolidated'],
    queryFn: () => api<Consolidated>('/api/consolidated'),
    enabled,
  });
}

export function useSpaceMembers(spaceId: string, enabled = true) {
  return useQuery({
    queryKey: ['space-members', spaceId],
    queryFn: () =>
      api<{ items: SpaceMember[] }>(`/api/spaces/${spaceId}/members`).then((r) => r.items),
    enabled,
  });
}

export function useSpaceMutations() {
  const qc = useQueryClient();
  const refreshMe = () => qc.invalidateQueries({ queryKey: ['me'] });
  return {
    create: useMutation({
      mutationFn: (name: string) =>
        api<SpaceSummary>('/api/spaces', { method: 'POST', body: { name } }),
      onSuccess: refreshMe,
    }),
    rename: useMutation({
      mutationFn: ({ id, name }: { id: string; name: string }) =>
        api<SpaceSummary>(`/api/spaces/${id}`, { method: 'PATCH', body: { name } }),
      onSuccess: refreshMe,
    }),
    invite: useMutation({
      mutationFn: ({ spaceId, email }: { spaceId: string; email?: string }) =>
        api<Invite>('/api/invites', {
          method: 'POST',
          body: { spaceId, ...(email ? { email } : {}) },
        }),
    }),
    accept: useMutation({
      mutationFn: (code: string) =>
        api<SpaceSummary>('/api/invites/accept', { method: 'POST', body: { code } }),
      onSuccess: refreshMe,
    }),
    transfer: useMutation({
      mutationFn: ({ spaceId, userId }: { spaceId: string; userId: string }) =>
        api<SpaceSummary>(`/api/spaces/${spaceId}/transfer`, {
          method: 'POST',
          body: { userId },
        }),
      onSuccess: async () => {
        await qc.invalidateQueries({ queryKey: ['space-members'] });
        await refreshMe();
      },
    }),
    // Excluir pode tirar o espaço ativo: recarrega tudo (o ativo volta para o pessoal).
    remove: useMutation({
      mutationFn: ({ spaceId, confirmName }: { spaceId: string; confirmName: string }) =>
        api(`/api/spaces/${spaceId}`, { method: 'DELETE', body: { confirmName } }),
      onSuccess: () => qc.invalidateQueries(),
    }),
    removeMember: useMutation({
      mutationFn: ({ spaceId, userId }: { spaceId: string; userId: string }) =>
        api(`/api/spaces/${spaceId}/members/${userId}`, { method: 'DELETE' }),
      onSuccess: async () => {
        await qc.invalidateQueries({ queryKey: ['space-members'] });
        await refreshMe();
      },
    }),
  };
}

export function useCoupleBalance(enabled = true) {
  const spaceId = useSpaceId();
  return useQuery({
    queryKey: ['couple', spaceId, 'balance'],
    queryFn: () => api<CoupleBalance>(spacePath(spaceId, '/couple/balance')),
    enabled,
  });
}

export function useTransactionSplit(transactionId: string, enabled = true) {
  const spaceId = useSpaceId();
  return useQuery({
    queryKey: ['couple', spaceId, 'split', transactionId],
    queryFn: () => api<CoupleSplit>(spacePath(spaceId, `/transactions/${transactionId}/split`)),
    enabled,
  });
}

export function useSplitSettings(enabled = true) {
  const spaceId = useSpaceId();
  return useQuery({
    queryKey: ['couple', spaceId, 'settings'],
    queryFn: () => api<SplitSettings>(spacePath(spaceId, '/split-settings')),
    enabled,
  });
}

export function useCoupleMutations() {
  const spaceId = useSpaceId();
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['couple', spaceId] });
  return {
    saveSplit: useMutation({
      mutationFn: ({ id, ...body }: CoupleSplitBody & { id: string }) =>
        api(spacePath(spaceId, `/transactions/${id}/split`), { method: 'PUT', body }),
      onSuccess: invalidate,
    }),
    settle: useMutation({
      mutationFn: (body: SettlementBody) =>
        api(spacePath(spaceId, '/couple/settlements'), { method: 'POST', body }),
      onSuccess: invalidate,
    }),
    undoSettlement: useMutation({
      mutationFn: (id: string) =>
        api(spacePath(spaceId, `/couple/settlements/${id}`), { method: 'DELETE' }),
      onSuccess: invalidate,
    }),
    saveSettings: useMutation({
      mutationFn: (body: SplitSettingsBody) =>
        api<SplitSettings>(spacePath(spaceId, '/split-settings'), { method: 'PUT', body }),
      onSuccess: invalidate,
    }),
  };
}

export function useGroups() {
  return useQuery({
    queryKey: ['racha', 'groups'],
    queryFn: () => api<{ items: GroupSummary[] }>('/api/split-groups').then((r) => r.items),
  });
}

export function useGroup(id: string) {
  return useQuery({
    queryKey: ['racha', 'group', id],
    queryFn: () => api<GroupDetail>(`/api/split-groups/${id}`),
  });
}

export function useRachaMutations(groupId?: string) {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ['racha'] });
  const base = `/api/split-groups/${groupId ?? ''}`;
  return {
    create: useMutation({
      mutationFn: (body: { name: string; friends?: string[] }) =>
        api<{ id: string }>('/api/split-groups', { method: 'POST', body }),
      onSuccess: refresh,
    }),
    join: useMutation({
      mutationFn: (body: { code: string; participantId?: string }) =>
        api<{ id: string }>('/api/split-groups/join', { method: 'POST', body }),
      onSuccess: refresh,
    }),
    update: useMutation({
      mutationFn: (body: { name?: string; archived?: boolean }) =>
        api(base, { method: 'PATCH', body }),
      onSuccess: refresh,
    }),
    addParticipant: useMutation({
      mutationFn: (name: string) => api(`${base}/participants`, { method: 'POST', body: { name } }),
      onSuccess: refresh,
    }),
    removeParticipant: useMutation({
      mutationFn: (id: string) => api(`${base}/participants/${id}`, { method: 'DELETE' }),
      onSuccess: refresh,
    }),
    saveExpense: useMutation({
      mutationFn: ({ id, ...body }: GroupExpenseBody & { id?: string }) =>
        id
          ? api(`${base}/expenses/${id}`, { method: 'PUT', body })
          : api(`${base}/expenses`, { method: 'POST', body }),
      onSuccess: refresh,
    }),
    removeExpense: useMutation({
      mutationFn: (id: string) => api(`${base}/expenses/${id}`, { method: 'DELETE' }),
      onSuccess: refresh,
    }),
    settle: useMutation({
      mutationFn: (body: GroupSettlementBody) =>
        api(`${base}/settlements`, { method: 'POST', body }),
      onSuccess: refresh,
    }),
    undoSettlement: useMutation({
      mutationFn: (id: string) => api(`${base}/settlements/${id}`, { method: 'DELETE' }),
      onSuccess: refresh,
    }),
  };
}

export function useGroupLink(groupId: string) {
  return useQuery({
    queryKey: ['racha', 'link', groupId],
    queryFn: () => api<GroupLink>(`/api/split-groups/${groupId}/link`),
  });
}

export function useGroupLinkMutations(groupId: string) {
  const qc = useQueryClient();
  // O lançamento nasce no espaço do usuário: atualiza também contas e lançamentos.
  const refresh = () => qc.invalidateQueries();
  return {
    save: useMutation({
      mutationFn: (body: GroupLinkBody) =>
        api<SyncResult>(`/api/split-groups/${groupId}/link`, { method: 'PUT', body }),
      onSuccess: refresh,
    }),
    sync: useMutation({
      mutationFn: () =>
        api<SyncResult>(`/api/split-groups/${groupId}/link/sync`, { method: 'POST' }),
      onSuccess: refresh,
    }),
    unlink: useMutation({
      mutationFn: () => api(`/api/split-groups/${groupId}/link`, { method: 'DELETE' }),
      onSuccess: refresh,
    }),
  };
}

/** Contas e categorias de despesa de um espaço específico (não só o ativo). */
export function useSpaceChoices(spaceId: string) {
  return useQuery({
    queryKey: ['space-choices', spaceId],
    enabled: spaceId !== '',
    queryFn: async () => {
      const [accounts, categories] = await Promise.all([
        api<{ items: Account[] }>(`/api/spaces/${spaceId}/accounts`),
        api<{ items: Category[] }>(`/api/spaces/${spaceId}/categories?kind=expense`),
      ]);
      return { accounts: accounts.items, categories: categories.items };
    },
  });
}

export function useCategoryMutations() {
  const spaceId = useSpaceId();
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: keys.categories(spaceId) });
  return {
    create: useMutation({
      mutationFn: (body: CreateCategoryBody) =>
        api<Category>(spacePath(spaceId, '/categories'), { method: 'POST', body }),
      onSuccess: refresh,
    }),
    update: useMutation({
      mutationFn: ({ id, ...body }: UpdateCategoryBody & { id: string }) =>
        api<Category>(spacePath(spaceId, `/categories/${id}`), { method: 'PATCH', body }),
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: (id: string) =>
        api(spacePath(spaceId, `/categories/${id}`), { method: 'DELETE' }),
      onSuccess: refresh,
    }),
  };
}

export function useInvites() {
  return useQuery({
    queryKey: ['invites'],
    queryFn: () => api<{ items: Invite[] }>('/api/invites').then((r) => r.items),
  });
}

export function useInviteMutations() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ['invites'] });
  return {
    create: useMutation({
      mutationFn: (body: { email?: string; expiresInDays?: number }) =>
        api<Invite>('/api/invites', { method: 'POST', body }),
      onSuccess: refresh,
    }),
    revoke: useMutation({
      mutationFn: (id: string) => api(`/api/invites/${id}`, { method: 'DELETE' }),
      onSuccess: refresh,
    }),
  };
}

export function useIndexValues() {
  const spaceId = useSpaceId();
  return useQuery({
    queryKey: ['index-values', spaceId],
    queryFn: () =>
      api<{ items: IndexValue[] }>(spacePath(spaceId, '/index-values')).then((r) => r.items),
  });
}

/** Busca agora INCC, IPCA e IGP-M nas fontes oficiais (IBGE, Banco Central, Ipea). */
export function useSyncIndexValues() {
  const spaceId = useSpaceId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api<{
        saved: Record<'incc' | 'ipca' | 'igpm', number>;
        errors: Partial<Record<'incc' | 'ipca' | 'igpm', string>>;
      }>(spacePath(spaceId, '/index-values/sync'), { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['index-values', spaceId] }),
  });
}

/** "E se eu quitar ou amortizar R$ X?": simula sem gravar nada. */
export function useSimulateDebt() {
  const spaceId = useSpaceId();
  return useMutation({
    mutationFn: ({ id, amount, phaseId }: { id: string; amount?: number; phaseId?: string }) =>
      api<SimulatePayoff>(spacePath(spaceId, `/debts/${id}/simulate`), {
        method: 'POST',
        body: { ...(amount ? { amount } : {}), ...(phaseId ? { phaseId } : {}) },
      }),
  });
}
