import type {
  Account,
  Projection,
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
import { api, spacePath } from './api';

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
