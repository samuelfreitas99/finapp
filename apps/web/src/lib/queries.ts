import type {
  Account,
  Category,
  CreateAccountBody,
  CreateAdjustmentBody,
  Transaction,
  UpdateAccountBody,
} from '@finapp/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
      api<{ items: Category[] }>(spacePath(spaceId, '/categories')).then((r) => r.items),
    staleTime: 5 * 60_000,
  });
}
