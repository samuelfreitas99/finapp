import { todayIn } from '@finapp/core';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import { createAuth } from '../auth/auth';
import { createAdminInvite } from '../cli/create-invite';
import type { Db } from '../db/client';
import { notifications } from '../db/schema';
import type { PushPayload, PushSender } from '../modules/notifications/push';
import { createTempDb, testDatabaseUrl } from '../test/temp-db';
import { clockIn, generateAlerts, sendPending } from './alerts';

const appUrl = 'http://localhost:5174';
const TODAY = '2026-10-15';

describe.skipIf(!testDatabaseUrl)('daily alerts job (integration)', () => {
  let drop: () => Promise<void>;
  let db: Db;
  let app: ReturnType<typeof buildApp>;
  let cookie: string;
  let spaceId: string;
  const pushed: PushPayload[] = [];
  const fakePush: PushSender = {
    publicKey: 'x',
    send: async (_u, p) => {
      pushed.push(p);
      return 1;
    },
  };

  const api = (method: 'GET' | 'POST' | 'PATCH', path: string, payload?: unknown) =>
    app.inject({
      method,
      url: path.startsWith('/api/') ? path : `/api/spaces/${spaceId}${path}`,
      headers: { cookie, origin: appUrl },
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });

  beforeAll(async () => {
    const temp = await createTempDb();
    drop = temp.drop;
    db = temp.db;
    const auth = createAuth({
      db,
      secret: 'test-secret-test-secret-test-secret-00',
      appUrl,
      production: false,
    });
    app = buildApp({ db, auth, appUrl, today: () => TODAY });
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { origin: appUrl },
      payload: {
        name: 'S',
        email: 's@ex.com',
        password: 'senha-forte-1',
        inviteCode: await createAdminInvite(temp.url),
      },
    });
    const raw = res.headers['set-cookie'];
    cookie = (Array.isArray(raw) ? raw : [String(raw)]).map((c) => c.split(';')[0]).join('; ');
    spaceId = (await app.inject({ method: 'GET', url: '/api/me', headers: { cookie } })).json()
      .activeSpaceId;

    const account = (
      await api('POST', '/accounts', {
        name: 'Conta',
        type: 'checking',
        initialBalance: 1000,
        initialDate: '2026-01-01',
      })
    ).json();
    const tx = (body: Record<string, unknown>) =>
      api('POST', '/transactions', { accountId: account.id, status: 'planned', ...body });
    await tx({ type: 'expense', amount: 11990, date: '2026-10-17', description: 'Internet' });
    await tx({ type: 'expense', amount: 40000, date: '2026-10-12', description: 'Luz' });
    await tx({ type: 'income', amount: 50000, date: '2026-10-14', description: 'Freela' });
    const card = (
      await api('POST', '/cards', {
        name: 'Nubank',
        limitAmount: 10000,
        closingDay: 16,
        dueDay: 23,
      })
    ).json();
    await api('POST', '/transactions', {
      type: 'expense',
      amount: 9000,
      date: '2026-10-10',
      description: 'Mercado',
      cardId: card.id,
    });
  });

  afterAll(async () => {
    await app?.close();
    await drop?.();
  });

  it('creates each alert once per user and pushes them outside quiet hours (RN 9)', async () => {
    const created = await generateAlerts(db, TODAY);
    const rows = await db.select().from(notifications);
    expect(rows.map((r) => r.type).sort()).toEqual(
      [
        'card_limit',
        'due_soon',
        'income_unconfirmed',
        'invoice_closing',
        'negative_forecast',
        'overdue',
      ].sort(),
    );
    expect(created).toBe(rows.length);
    expect(await generateAlerts(db, TODAY)).toBe(0);

    // Silêncio das 22:00 às 07:00: às 23:00 (São Paulo) nada sai.
    await api('PATCH', '/api/notification-settings', { quietStart: '22:00', quietEnd: '07:00' });
    // Datas reais (a janela de envio é das últimas 24 h a partir da criação).
    const day = todayIn();
    const night = new Date(`${day}T23:00:00-03:00`);
    expect(clockIn(night)).toBe('23:00');
    expect(await sendPending(db, fakePush, night)).toBe(0);
    const morning = new Date(`${day}T08:00:00-03:00`);
    expect(await sendPending(db, fakePush, morning)).toBe(rows.length);
    expect(pushed.map((p) => p.title)).toContain('Vence em 2 dias: Internet');
    expect(await sendPending(db, fakePush, morning)).toBe(0);
    const sentRows = await db.select().from(notifications).where(eq(notifications.type, 'overdue'));
    expect(sentRows[0]?.sentAt).not.toBeNull();

    const center = (await api('GET', '/api/notifications')).json();
    expect(center.unread).toBe(rows.length);
  });
});
