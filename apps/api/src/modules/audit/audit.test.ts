import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app';
import { createAuth } from '../../auth/auth';
import { createAdminInvite } from '../../cli/create-invite';
import { createTempDb, testDatabaseUrl } from '../../test/temp-db';
import { sanitizeBody } from '../spaces/audit';

const appUrl = 'http://localhost:5174';
const TODAY = '2026-10-15';

describe('sanitizeBody', () => {
  it('drops sensitive fields and shortens long text', () => {
    const out = sanitizeBody({
      name: 'x',
      password: 'p',
      pin: '1234',
      content: 'abc',
      note: 'a'.repeat(300),
    });
    expect(out).toEqual({ name: 'x', note: `${'a'.repeat(200)}…` });
    expect(sanitizeBody(Buffer.from('x'))).toBeNull();
    expect(sanitizeBody(null)).toBeNull();
    expect(
      sanitizeBody({
        big: 'x'.repeat(190),
        more: 'y'.repeat(190),
        z: 'z'.repeat(190),
        w: 'w'.repeat(190),
        v: 'v'.repeat(190),
        u: 'u'.repeat(190),
        t: 't'.repeat(190),
        s: 's'.repeat(190),
        r: 'r'.repeat(190),
        q: 'q'.repeat(190),
        p2: 'p'.repeat(190),
        o: 'o'.repeat(190),
        n: 'n'.repeat(190),
        m: 'm'.repeat(190),
        l: 'l'.repeat(190),
        k: 'k'.repeat(190),
        j: 'j'.repeat(190),
        i: 'i'.repeat(190),
        h: 'h'.repeat(190),
        g: 'g'.repeat(190),
        f: 'f'.repeat(190),
        e: 'e'.repeat(190),
        d: 'd'.repeat(190),
        c: 'c'.repeat(190),
        b: 'b'.repeat(190),
        a: 'a'.repeat(190),
      }),
    ).toEqual({ truncated: true });
  });
});

describe.skipIf(!testDatabaseUrl)('audit log (integration)', () => {
  let drop: () => Promise<void>;
  let app: ReturnType<typeof buildApp>;
  let cookie: string;
  let spaceId: string;

  const call = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, payload?: unknown) =>
    app.inject({
      method,
      url: `/api/spaces/${spaceId}${path}`,
      headers: { cookie, origin: appUrl },
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });
  const flush = () => new Promise((r) => setTimeout(r, 100));

  beforeAll(async () => {
    const temp = await createTempDb();
    drop = temp.drop;
    const auth = createAuth({
      db: temp.db,
      secret: 'test-secret-test-secret-test-secret-00',
      appUrl,
      production: false,
    });
    app = buildApp({ db: temp.db, auth, appUrl, today: () => TODAY });
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { origin: appUrl },
      payload: {
        name: 'Samuel',
        email: 'samuel@ex.com',
        password: 'senha-forte-1',
        inviteCode: await createAdminInvite(temp.url),
      },
    });
    const raw = res.headers['set-cookie'];
    cookie = (Array.isArray(raw) ? raw : [String(raw)]).map((c) => c.split(';')[0]).join('; ');
    spaceId = (await app.inject({ method: 'GET', url: '/api/me', headers: { cookie } })).json()
      .activeSpaceId;
  });

  afterAll(async () => {
    await app?.close();
    await drop?.();
  });

  it('records successful writes with who, what and the sanitized body', async () => {
    const account = (
      await call('POST', '/accounts', {
        name: 'Conta',
        type: 'checking',
        initialBalance: 1000,
        initialDate: '2026-01-01',
      })
    ).json();
    await call('PATCH', `/accounts/${account.id}`, { name: 'Conta Nova' });
    await call('GET', '/accounts');
    await call('POST', '/accounts', { name: '' }); // inválido: não registra
    await flush();

    const { items } = (await call('GET', '/audit-log')).json();
    expect(
      items.map((i: { action: string; entityType: string }) => [i.entityType, i.action]),
    ).toEqual([
      ['accounts', 'update'],
      ['accounts', 'create'],
    ]);
    expect(items[0]).toMatchObject({
      userName: 'Samuel',
      entityId: account.id,
      after: { name: 'Conta Nova' },
    });
  });

  it('ignores previews, filters by entity and paginates', async () => {
    await call('POST', '/goals', { name: 'Meta', targetAmount: 1000 });
    await call('POST', '/import/preview', {
      accountId: crypto.randomUUID(),
      format: 'csv',
      content: 'x',
    });
    await flush();
    const page1 = (await call('GET', '/audit-log?limit=1')).json();
    expect(page1.items).toHaveLength(1);
    expect(page1.nextCursor).toBeTruthy();
    const page2 = (await call('GET', `/audit-log?limit=5&cursor=${page1.nextCursor}`)).json();
    expect(page2.items.length).toBeGreaterThanOrEqual(1);
    const all = (await call('GET', '/audit-log?limit=50')).json().items as { entityType: string }[];
    expect(all.some((i) => i.entityType === 'import')).toBe(false);
    expect((await call('GET', '/audit-log?entity=goals')).json().items).toHaveLength(1);
  });
});
