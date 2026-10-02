/** Configuração lida do ambiente. */
export interface Config {
  databaseUrl: string | undefined;
  authSecret: string | undefined;
  /** URL pública do app (ex.: https://financas.voleidraft.top). */
  appUrl: string;
  production: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const production = env.NODE_ENV === 'production';
  const config: Config = {
    databaseUrl: env.DATABASE_URL,
    authSecret: env.BETTER_AUTH_SECRET,
    appUrl: env.APP_URL ?? 'http://localhost:5174',
    production,
  };
  if (production && (!config.databaseUrl || !config.authSecret || config.authSecret.length < 32)) {
    throw new Error(
      'Em produção, DATABASE_URL e BETTER_AUTH_SECRET (>= 32 caracteres) são obrigatórios.',
    );
  }
  return config;
}
