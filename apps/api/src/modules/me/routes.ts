import { pinBodySchema, setPinBodySchema, type MeResponse } from '@finapp/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../../db/client';
import { userSettings, users } from '../../db/schema';
import { ApiError, badRequest } from '../../http/errors';
import { currentUser, requireUser } from '../../plugins/auth';
import { userSpaces } from '../spaces/access';
import { hashPin, PinThrottle, verifyPin } from './pin';

export function meRoutes(app: FastifyInstance, db: Db, throttle = new PinThrottle()) {
  const pinHash = async (userId: string) => {
    const [row] = await db
      .select({ hash: userSettings.lockPinHash })
      .from(userSettings)
      .where(eq(userSettings.userId, userId));
    return row?.hash ?? null;
  };

  /** Confere o PIN respeitando a trava de tentativas; erra com 400/429. */
  const checkPin = async (userId: string, pin: string) => {
    const wait = throttle.waitSeconds(userId);
    if (wait > 0) {
      throw new ApiError(429, 'pin_locked', `Muitas tentativas. Tente de novo em ${wait} s.`);
    }
    const hash = await pinHash(userId);
    if (!hash || !(await verifyPin(pin, hash))) {
      throttle.fail(userId);
      throw badRequest('pin_invalid', 'PIN incorreto.');
    }
    throttle.success(userId);
  };

  const savePin = (userId: string, hash: string | null) =>
    db
      .insert(userSettings)
      .values({ userId, lockPinHash: hash })
      .onConflictDoUpdate({ target: userSettings.userId, set: { lockPinHash: hash } });

  app.get('/api/me', { preHandler: requireUser }, async (request): Promise<MeResponse> => {
    const user = currentUser(request);
    const [spaces, [settings], [account]] = await Promise.all([
      userSpaces(db, user.id),
      db
        .select({
          activeSpaceId: userSettings.activeSpaceId,
          lockPinHash: userSettings.lockPinHash,
        })
        .from(userSettings)
        .where(eq(userSettings.userId, user.id)),
      db
        .select({ twoFactorEnabled: users.twoFactorEnabled })
        .from(users)
        .where(eq(users.id, user.id)),
    ]);
    return {
      user,
      spaces,
      activeSpaceId: settings?.activeSpaceId ?? spaces[0]?.id ?? null,
      pinEnabled: Boolean(settings?.lockPinHash),
      twoFactorEnabled: account?.twoFactorEnabled ?? false,
    };
  });

  /** Define ou troca o PIN de bloqueio do app (trocar exige o PIN atual). */
  app.put('/api/me/pin', { preHandler: requireUser }, async (request, reply) => {
    const user = currentUser(request);
    const body = setPinBodySchema.parse(request.body ?? {});
    if (await pinHash(user.id)) {
      if (!body.currentPin) throw badRequest('pin_required', 'Informe o PIN atual.');
      await checkPin(user.id, body.currentPin);
    }
    await savePin(user.id, await hashPin(body.pin));
    return reply.code(204).send();
  });

  /** Confere o PIN para desbloquear o app. */
  app.post('/api/me/pin/verify', { preHandler: requireUser }, async (request, reply) => {
    const body = pinBodySchema.parse(request.body ?? {});
    await checkPin(currentUser(request).id, body.pin);
    return reply.code(204).send();
  });

  /** Remove o bloqueio (exige o PIN). */
  app.delete('/api/me/pin', { preHandler: requireUser }, async (request, reply) => {
    const user = currentUser(request);
    const body = pinBodySchema.parse(request.body ?? {});
    await checkPin(user.id, body.pin);
    await savePin(user.id, null);
    return reply.code(204).send();
  });
}
