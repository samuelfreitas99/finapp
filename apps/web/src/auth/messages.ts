import { ApiError } from '../lib/api';

/** Mensagens do Better Auth (em inglês) traduzidas pelo código. */
const BY_CODE: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: 'E-mail ou senha incorretos.',
  USER_ALREADY_EXISTS: 'Já existe uma conta com este e-mail. Entre com ela.',
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: 'Já existe uma conta com este e-mail. Entre com ela.',
  PASSWORD_TOO_SHORT: 'A senha precisa ter pelo menos 8 caracteres.',
  PASSWORD_TOO_LONG: 'A senha pode ter no máximo 128 caracteres.',
  INVALID_EMAIL: 'Confira o e-mail digitado.',
};

export function authErrorMessage(err: unknown): string {
  if (err instanceof ApiError) return BY_CODE[err.code] ?? err.message;
  return 'Algo deu errado. Tente de novo.';
}
