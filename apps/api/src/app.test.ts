import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { healthResponseSchema } from '@finapp/shared';
import { describe, expect, it } from 'vitest';
import { buildApp } from './app';
import { loadConfig } from './config';

describe('GET /api/health', () => {
  it('returns ok', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(healthResponseSchema.parse(res.json()).status).toBe('ok');
    await app.close();
  });
});

describe('web build serving', () => {
  const dist = mkdtempSync(join(tmpdir(), 'finapp-web-'));
  writeFileSync(join(dist, 'index.html'), '<!doctype html><title>FinApp</title>');

  it('serves index.html for SPA routes', async () => {
    const app = buildApp({ webDist: dist });
    const res = await app.inject({ method: 'GET', url: '/contas/123' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('FinApp');
    await app.close();
  });

  it('keeps unknown API routes as JSON 404', async () => {
    const app = buildApp({ webDist: dist });
    const res = await app.inject({ method: 'GET', url: '/api/nao-existe' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: { code: 'not_found' } });
    await app.close();
  });
});

describe('old domain redirect', () => {
  const app = buildApp({
    appUrl: 'https://app.novo.com.br',
    redirectHosts: ['financas.voleidraft.top'],
  });

  it('sends the old host to the same path on the new domain', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/dividas/123?x=1',
      headers: { host: 'financas.voleidraft.top' },
    });
    expect(res.statusCode).toBe(301);
    expect(res.headers.location).toBe('https://app.novo.com.br/dividas/123?x=1');
  });

  it('leaves the new host and the local health check alone', async () => {
    for (const host of ['app.novo.com.br', '127.0.0.1:3000']) {
      const res = await app.inject({ method: 'GET', url: '/api/health', headers: { host } });
      expect(res.statusCode).toBe(200);
    }
  });
});

describe('loadConfig REDIRECT_HOSTS', () => {
  it('splits, trims and lowercases the list', () => {
    expect(
      loadConfig({ REDIRECT_HOSTS: ' Financas.Voleidraft.top, ,old.example.com' }).redirectHosts,
    ).toEqual(['financas.voleidraft.top', 'old.example.com']);
    expect(loadConfig({}).redirectHosts).toEqual([]);
  });
});
