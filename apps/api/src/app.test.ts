import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { healthResponseSchema } from '@finapp/shared';
import { describe, expect, it } from 'vitest';
import { buildApp } from './app';

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
