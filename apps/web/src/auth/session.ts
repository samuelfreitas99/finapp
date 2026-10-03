import type { MeResponse, Onboarding, UpdateOnboardingBody } from '@finapp/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';

export const meKey = ['me'] as const;

/** Sessão atual (`null` se não estiver logado). */
export function useMe() {
  return useQuery({
    queryKey: meKey,
    queryFn: async () => {
      try {
        return await api<MeResponse>('/api/me');
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: 60_000,
  });
}

/** Espaço ativo (o pessoal, enquanto não houver seletor de espaço). */
export function useActiveSpace() {
  const { data } = useMe();
  if (!data) return null;
  return data.spaces.find((s) => s.id === data.activeSpaceId) ?? data.spaces[0] ?? null;
}

export function useSignIn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { email: string; password: string }) =>
      api<{ twoFactorRedirect?: boolean }>('/api/auth/sign-in/email', { method: 'POST', body }),
    // Com verificação em duas etapas, a sessão só nasce depois do código.
    onSuccess: (data) => {
      if (!data?.twoFactorRedirect) return qc.invalidateQueries({ queryKey: meKey });
    },
  });
}

/** Segundo passo do login: código do aplicativo ou código de backup. */
export function useVerifyTwoFactor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ code, backup }: { code: string; backup: boolean }) =>
      api(backup ? '/api/auth/two-factor/verify-backup-code' : '/api/auth/two-factor/verify-totp', {
        method: 'POST',
        body: { code },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: meKey }),
  });
}

export function useSignUp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; email: string; password: string; inviteCode: string }) =>
      api('/api/auth/sign-up/email', { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: meKey }),
  });
}

export function useSignOut() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api('/api/auth/sign-out', { method: 'POST', body: {} }),
    onSuccess: () => {
      qc.clear();
      qc.setQueryData(meKey, null);
    },
  });
}

/** Esconde os "primeiros passos" ou marca passos como "não se aplica". */
export function useUpdateOnboarding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateOnboardingBody) =>
      api<Onboarding>('/api/me/onboarding', { method: 'PUT', body }),
    onSuccess: (onboarding) =>
      qc.setQueryData<MeResponse | null>(meKey, (me) => (me ? { ...me, onboarding } : me)),
  });
}
