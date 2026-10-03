import { ApiError } from '../lib/api';

/** Mensagens do Better Auth (em inglês) traduzidas pelo código. */
const BY_CODE: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: 'E-mail ou senha incorretos.',
  USER_ALREADY_EXISTS: 'Já existe uma conta com este e-mail. Entre com ela.',
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: 'Já existe uma conta com este e-mail. Entre com ela.',
  PASSWORD_TOO_SHORT: 'A senha precisa ter pelo menos 8 caracteres.',
  PASSWORD_TOO_LONG: 'A senha pode ter no máximo 128 caracteres.',
  INVALID_EMAIL: 'Confira o e-mail digitado.',
  INVALID_CODE: 'Código incorreto. Confira o aplicativo e tente de novo.',
  INVALID_BACKUP_CODE: 'Código de backup inválido ou já usado.',
  INVALID_PASSWORD: 'Senha incorreta.',
  ACCOUNT_TEMPORARILY_LOCKED: 'Muitas tentativas erradas. Aguarde alguns minutos.',
  TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE: 'Muitas tentativas. Entre de novo para continuar.',
  INVALID_TWO_FACTOR_COOKIE: 'A verificação expirou. Entre de novo com a senha.',
  TOTP_ALREADY_ENABLED: 'A verificação em duas etapas já está ligada.',
  INVALID_TOKEN: 'Este link já foi usado ou expirou. Peça um novo em "Esqueci a senha".',
};

export function authErrorMessage(err: unknown): string {
  if (err instanceof ApiError) return BY_CODE[err.code] ?? err.message;
  return 'Algo deu errado. Tente de novo.';
}
