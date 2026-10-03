import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app';
import { createAuth } from '../../auth/auth';
import { createAdminInvite } from '../../cli/create-invite';
import { createTempDb, testDatabaseUrl } from '../../test/temp-db';
import { cleanFileName, sniffMime } from './routes';

const appUrl = 'http://localhost:5174';
const TODAY = '2026-10-15';

describe('sniffMime', () => {
  it('recognizes images and PDF by content', () => {
    expect(sniffMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0]))).toBe('image/jpeg');
    expect(sniffMime(Buffer.from('89504e470d0a1a0a0000', 'hex'))).toBe('image/png');
    expect(sniffMime(Buffer.from('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp');
    expect(sniffMime(Buffer.from('%PDF-1.7\n'))).toBe('application/pdf');
    expect(sniffMime(Buffer.from('<html><script>alert(1)</script>'))).toBeNull();
    expect(sniffMime(Buffer.alloc(0))).toBeNull();
  });

  it('cleans file names', () => {
    expect(cleanFileName('../../etc/passwd', 'image/png')).toBe('passwd');
    expect(cleanFileName('C:\\fotos\\nota "1".jpg', 'image/jpeg')).toBe('nota 1.jpg');
    expect(cleanFileName(undefined, 'application/pdf')).toBe('comprovante.pdf');
  });
});

describe.skipIf(!testDatabaseUrl)('attachments API (integration)', () => {
  let drop: () => Promise<void>;
  let app: ReturnType<typeof buildApp>;
  let cookie: string;
  let spaceId: string;
  let txId: string;

  const url = (path: string) => `/api/spaces/${spaceId}${path}`;
  const json = (method: 'GET' | 'POST' | 'DELETE', path: string, payload?: unknown) =>
    app.inject({
      method,
      url: url(path),
      headers: { cookie, origin: appUrl },
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });
  const upload = (path: string, body: Buffer, contentType: string) =>
    app.inject({
      method: 'POST',
      url: url(path),
      headers: { cookie, origin: appUrl, 'content-type': contentType },
      payload: body,
    });

  const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(100, 7)]);

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
    const accountId = (
      await json('POST', '/accounts', {
        name: 'Conta',
        type: 'checking',
        initialBalance: 100000,
        initialDate: '2026-01-01',
      })
    ).json().id;
    txId = (
      await json('POST', '/transactions', {
        type: 'expense',
        status: 'settled',
        amount: 5000,
        date: '2026-10-10',
        description: 'Farmácia',
        accountId,
      })
    ).json().id;
  });

  afterAll(async () => {
    await app?.close();
    await drop?.();
  });

  it('uploads, lists, serves and removes a receipt', async () => {
    const created = await upload(
      `/transactions/${txId}/attachments?name=${encodeURIComponent('nota fiscal.png')}`,
      png,
      'image/png',
    );
    expect(created.statusCode).toBe(201);
    const att = created.json();
    expect(att).toMatchObject({ fileName: 'nota fiscal.png', mime: 'image/png', size: png.length });

    const list = (await json('GET', `/transactions/${txId}/attachments`)).json().items;
    expect(list).toHaveLength(1);
    expect(list[0]).not.toHaveProperty('data');

    const file = await app.inject({
      method: 'GET',
      url: url(`/attachments/${att.id}/file`),
      headers: { cookie },
    });
    expect(file.statusCode).toBe(200);
    expect(file.headers['content-type']).toBe('image/png');
    expect(file.headers['x-content-type-options']).toBe('nosniff');
    expect(file.rawPayload.equals(png)).toBe(true);

    expect((await json('DELETE', `/attachments/${att.id}`)).statusCode).toBe(204);
    expect((await json('GET', `/transactions/${txId}/attachments`)).json().items).toHaveLength(0);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: url(`/attachments/${att.id}/file`),
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(404);
  });

  it('trusts the content, not the declared type', async () => {
    const fake = await upload(
      `/transactions/${txId}/attachments?name=x.png`,
      Buffer.from('<script>alert(1)</script>'),
      'image/png',
    );
    expect(fake.statusCode).toBe(400);
    expect(fake.json().error.code).toBe('invalid_file');
    expect(
      (await upload(`/transactions/${txId}/attachments`, Buffer.alloc(0), 'image/png')).statusCode,
    ).toBe(400);
  });

  it('rejects unknown content types, huge files and unknown transactions', async () => {
    const text = await upload(`/transactions/${txId}/attachments`, Buffer.from('oi'), 'text/plain');
    expect(text.statusCode).toBeGreaterThanOrEqual(400);
    expect(text.statusCode).toBeLessThan(500);
    const huge = Buffer.concat([png, Buffer.alloc(8 * 1024 * 1024)]);
    expect((await upload(`/transactions/${txId}/attachments`, huge, 'image/png')).statusCode).toBe(
      413,
    );
    const none = await upload(`/transactions/${crypto.randomUUID()}/attachments`, png, 'image/png');
    expect(none.statusCode).toBe(404);
  });

  it('limits the number of receipts per transaction', async () => {
    for (let i = 0; i < 10; i++) {
      expect((await upload(`/transactions/${txId}/attachments`, png, 'image/png')).statusCode).toBe(
        201,
      );
    }
    const extra = await upload(`/transactions/${txId}/attachments`, png, 'image/png');
    expect(extra.statusCode).toBe(400);
    expect(extra.json().error.code).toBe('too_many_attachments');
  });
});
