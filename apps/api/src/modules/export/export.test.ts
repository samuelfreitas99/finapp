import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app';
import { createAuth } from '../../auth/auth';
import { createAdminInvite } from '../../cli/create-invite';
import { createTempDb, testDatabaseUrl } from '../../test/temp-db';

const appUrl = 'http://localhost:5174';
const TODAY = '2026-10-15';

describe.skipIf(!testDatabaseUrl)('export API (integration)', () => {
  let drop: () => Promise<void>;
  let app: ReturnType<typeof buildApp>;
  let cookie: string;
  let spaceId: string;

  const get = (path: string) =>
    app.inject({ method: 'GET', url: `/api/spaces/${spaceId}${path}`, headers: { cookie } });

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
    const post = (path: string, payload: unknown) =>
      app.inject({
        method: 'POST',
        url: `/api/spaces/${spaceId}${path}`,
        headers: { cookie, origin: appUrl },
        payload: payload as Record<string, unknown>,
      });
    const accountId = (
      await post('/accounts', {
        name: 'Conta',
        type: 'checking',
        initialBalance: 100000,
        initialDate: '2026-01-01',
      })
    ).json().id;
    for (const [type, amount, description] of [
      ['expense', 4590, '=SOMA(1;2)'],
      ['income', 350000, 'Salário; "bônus"'],
    ] as const) {
      await post('/transactions', {
        type,
        status: 'settled',
        amount,
        date: '2026-10-05',
        description,
        accountId,
      });
    }
  });

  afterAll(async () => {
    await app?.close();
    await drop?.();
  });

  it('exports CSV with signed decimal values and safe cells', async () => {
    const res = await get('/export?format=csv');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toContain('finapp-2026-10-15.csv');
    expect(res.body.startsWith('﻿Data;Tipo')).toBe(true);
    expect(res.body).toContain(
      "2026-10-05;Despesa;Efetivado;'=SOMA(1;2)".replace("'=SOMA(1;2)", '"\'=SOMA(1;2)"'),
    );
    expect(res.body).toContain('-45,90');
    expect(res.body).toContain('"Salário; ""bônus"""');
    expect(res.body).toContain('3500,00');
  });

  it('exports a valid XLSX file', async () => {
    const res = await get('/export?format=xlsx');
    expect(res.statusCode).toBe(200);
    expect(res.rawPayload.subarray(0, 2).toString('latin1')).toBe('PK');
  });

  it('exports full JSON in cents and rejects unknown formats', async () => {
    const res = await get('/export?format=json');
    const json = res.json();
    expect(json.transactions).toHaveLength(2);
    expect(json.accounts[0].initialBalance).toBe(100000);
    expect(json).not.toHaveProperty('users');
    expect((await get('/export?format=pdf')).statusCode).toBe(400);
  });

  it('is isolated by space', async () => {
    const other = await app.inject({
      method: 'GET',
      url: '/api/spaces/00000000-0000-4000-8000-000000000000/export',
      headers: { cookie },
    });
    expect(other.statusCode).toBe(404);
  });
});
