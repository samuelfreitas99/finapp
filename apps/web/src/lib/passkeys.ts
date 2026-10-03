import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { ApiError, api } from './api';

export interface PasskeyInfo {
  id: string;
  name: string | null;
  deviceType: string;
  backedUp: boolean;
  createdAt: string | null;
}

export const passkeysSupported = () =>
  typeof window !== 'undefined' && typeof window.PublicKeyCredential !== 'undefined';

/** O usuário fechou ou recusou a janela do sistema (não é erro de verdade). */
const cancelled = (err: unknown) =>
  err instanceof Error && (err.name === 'NotAllowedError' || err.name === 'AbortError');

const FRIENDLY =
  'Não foi possível usar a chave de acesso neste aparelho. Entre com e-mail e senha.';

/** Entra com uma chave de acesso; devolve `false` se a pessoa cancelou. */
export async function signInWithPasskey(): Promise<boolean> {
  try {
    const optionsJSON = await api<Parameters<typeof startAuthentication>[0]['optionsJSON']>(
      '/api/auth/passkey/generate-authenticate-options',
    );
    const response = await startAuthentication({ optionsJSON });
    await api('/api/auth/passkey/verify-authentication', { method: 'POST', body: { response } });
    return true;
  } catch (err) {
    if (cancelled(err)) return false;
    if (err instanceof ApiError) throw err;
    throw new ApiError(0, 'passkey_failed', FRIENDLY);
  }
}

/** Cadastra uma chave de acesso neste aparelho; devolve `false` se a pessoa cancelou. */
export async function registerPasskey(name: string): Promise<boolean> {
  try {
    const optionsJSON = await api<Parameters<typeof startRegistration>[0]['optionsJSON']>(
      '/api/auth/passkey/generate-register-options',
    );
    const response = await startRegistration({ optionsJSON });
    await api('/api/auth/passkey/verify-registration', {
      method: 'POST',
      body: { response, name },
    });
    return true;
  } catch (err) {
    if (cancelled(err)) return false;
    if (err instanceof ApiError) throw err;
    throw new ApiError(0, 'passkey_failed', FRIENDLY);
  }
}

export const listPasskeys = () => api<PasskeyInfo[]>('/api/auth/passkey/list-user-passkeys');

export const deletePasskey = (id: string) =>
  api('/api/auth/passkey/delete-passkey', { method: 'POST', body: { id } });
