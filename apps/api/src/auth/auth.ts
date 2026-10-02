import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError } from 'better-auth/api';
import { uuidv7 } from 'uuidv7';
import type { Db } from '../db/client';
import { authAccounts, sessions, users, verifications } from '../db/schema';
import { claimInvite, onboardUser } from './onboarding';

export interface AuthOptions {
  db: Db;
  secret: string;
  /** URL pública do app; a API fica em `${appUrl}/api/auth`. */
  appUrl: string;
  production: boolean;
}

/**
 * Better Auth com e-mail e senha. O cadastro exige `inviteCode` no corpo de
 * `POST /api/auth/sign-up/email`; ao criar o usuário, nasce o espaço pessoal.
 * Front e API no mesmo domínio: cookie de sessão HttpOnly, SameSite=Lax, Secure em HTTPS.
 * @see docs/arquitetura.md › Autenticação
 */
export function createAuth({ db, secret, appUrl, production }: AuthOptions) {
  // Convite reservado no "before" e ligado ao usuário no "after" do mesmo cadastro.
  const pendingInvites = new Map<string, string>();

  return betterAuth({
    appName: 'FinApp',
    secret,
    baseURL: appUrl,
    basePath: '/api/auth',
    trustedOrigins: [appUrl],
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: {
        user: users,
        session: sessions,
        account: authAccounts,
        verification: verifications,
      },
    }),
    emailAndPassword: {
      enabled: true,
      autoSignIn: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
    },
    rateLimit: {
      enabled: production,
      window: 60,
      max: 100,
      customRules: {
        '/sign-in/email': { window: 60, max: 5 },
        '/sign-up/email': { window: 60, max: 5 },
      },
    },
    advanced: {
      useSecureCookies: appUrl.startsWith('https://'),
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip', 'x-forwarded-for'] },
      database: { generateId: () => uuidv7() },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user, ctx) => {
            const body = (ctx?.body ?? {}) as { inviteCode?: unknown };
            const code = typeof body.inviteCode === 'string' ? body.inviteCode : '';
            if (!code) {
              throw new APIError('FORBIDDEN', {
                message: 'Cadastro só com código de convite.',
                code: 'INVITE_REQUIRED',
              });
            }
            const invite = await claimInvite(db, code, user.email);
            if (!invite) {
              throw new APIError('FORBIDDEN', {
                message: 'Convite inválido, expirado ou já usado.',
                code: 'INVITE_INVALID',
              });
            }
            pendingInvites.set(user.email.toLowerCase(), invite.id);
          },
          after: async (user) => {
            const key = user.email.toLowerCase();
            const inviteId = pendingInvites.get(key) ?? null;
            pendingInvites.delete(key);
            await onboardUser(db, user, inviteId);
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
