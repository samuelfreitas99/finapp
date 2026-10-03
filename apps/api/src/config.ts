import type { MailConfig } from './mail';

/** Configuração lida do ambiente. */
export interface Config {
  databaseUrl: string | undefined;
  authSecret: string | undefined;
  /** URL pública do app (ex.: https://financas.voleidraft.top). */
  appUrl: string;
  /** Domínios antigos que redirecionam (301) para `appUrl` (`REDIRECT_HOSTS`, separados por vírgula). */
  redirectHosts: string[];
  production: boolean;
  /** Web Push (VAPID). Sem as chaves, o push fica desligado. */
  push: PushConfig | null;
  /** E-mail (SMTP_URL + MAIL_FROM). Sem eles, nada é enviado por e-mail. */
  mail: MailConfig | null;
}

export interface PushConfig {
  publicKey: string;
  privateKey: string;
  /** `mailto:` ou URL de contato exigido pelo protocolo. */
  subject: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const production = env.NODE_ENV === 'production';
  const config: Config = {
    databaseUrl: env.DATABASE_URL,
    authSecret: env.BETTER_AUTH_SECRET,
    appUrl: env.APP_URL ?? 'http://localhost:5174',
    redirectHosts: (env.REDIRECT_HOSTS ?? '')
      .split(',')
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
    production,
    push:
      env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY
        ? {
            publicKey: env.VAPID_PUBLIC_KEY,
            privateKey: env.VAPID_PRIVATE_KEY,
            subject: env.VAPID_SUBJECT ?? 'mailto:admin@financas.voleidraft.top',
          }
        : null,
    mail: env.SMTP_URL && env.MAIL_FROM ? { smtpUrl: env.SMTP_URL, from: env.MAIL_FROM } : null,
  };
  if (production && (!config.databaseUrl || !config.authSecret || config.authSecret.length < 32)) {
    throw new Error(
      'Em produção, DATABASE_URL e BETTER_AUTH_SECRET (>= 32 caracteres) são obrigatórios.',
    );
  }
  return config;
}
