import { generateInviteCode } from '../auth/onboarding';
import { createDb } from '../db/client';
import { invites } from '../db/schema';

/**
 * Cria um convite de administrador (sem dono), para o primeiro cadastro ou para
 * convidar alguém direto pelo servidor.
 * Uso: pnpm --filter @finapp/api invite:create [dias]   (padrão 7; ver create-invite-cli.ts)
 * Em produção: docker exec finapp-api node server.cjs --create-invite
 */
export async function createAdminInvite(databaseUrl: string, days = 7): Promise<string> {
  const { db, pool } = createDb(databaseUrl);
  try {
    const code = generateInviteCode();
    await db.insert(invites).values({ code, expiresAt: new Date(Date.now() + days * 86_400_000) });
    return code;
  } finally {
    await pool.end();
  }
}
