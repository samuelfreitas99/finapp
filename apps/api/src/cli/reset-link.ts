import { randomBytes } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { resetPasswordUrl } from '../auth/auth';
import { createDb } from '../db/client';
import { users, verifications } from '../db/schema';

/**
 * Link de "redefinir senha" gerado pelo administrador, para quando o envio de e-mail
 * não está configurado. Mesmo formato do Better Auth (`reset-password:<token>`), vale 24 h.
 * Em produção: docker exec finapp-api node server.cjs --reset-link pessoa@email.com
 */
export async function createResetLink(
  databaseUrl: string,
  appUrl: string,
  email: string,
  hours = 24,
): Promise<string | null> {
  const { db, pool } = createDb(databaseUrl);
  try {
    const [user] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(sql`lower(${users.email})`, email.trim().toLowerCase()));
    if (!user) return null;
    const token = randomBytes(18).toString('base64url');
    await db.insert(verifications).values({
      identifier: `reset-password:${token}`,
      value: user.id,
      expiresAt: new Date(Date.now() + hours * 3_600_000),
    });
    return resetPasswordUrl(appUrl, token);
  } finally {
    await pool.end();
  }
}
