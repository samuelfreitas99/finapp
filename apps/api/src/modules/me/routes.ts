import type { MeResponse } from '@finapp/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../../db/client';
import { userSettings } from '../../db/schema';
import { currentUser, requireUser } from '../../plugins/auth';
import { userSpaces } from '../spaces/access';

export function meRoutes(app: FastifyInstance, db: Db) {
  app.get('/api/me', { preHandler: requireUser }, async (request): Promise<MeResponse> => {
    const user = currentUser(request);
    const [spaces, [settings]] = await Promise.all([
      userSpaces(db, user.id),
      db
        .select({ activeSpaceId: userSettings.activeSpaceId })
        .from(userSettings)
        .where(eq(userSettings.userId, user.id)),
    ]);
    return { user, spaces, activeSpaceId: settings?.activeSpaceId ?? spaces[0]?.id ?? null };
  });
}
