import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from './api';

const respond = (status: number, body: unknown) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(body === null ? null : JSON.stringify(body), { status })),
  );

describe('api', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns JSON and handles 204', async () => {
    respond(200, { ok: true });
    await expect(api('/api/x')).resolves.toEqual({ ok: true });
    respond(204, null);
    await expect(api('/api/x', { method: 'DELETE' })).resolves.toBeUndefined();
  });

  it('reads API and Better Auth error shapes', async () => {
    respond(400, { error: { code: 'settled_in_future', message: 'Use previsto.' } });
    await expect(api('/api/x')).rejects.toMatchObject({
      status: 400,
      code: 'settled_in_future',
      message: 'Use previsto.',
    });
    respond(401, { code: 'INVALID_EMAIL_OR_PASSWORD', message: 'Invalid' });
    await expect(api('/api/x')).rejects.toMatchObject({ code: 'INVALID_EMAIL_OR_PASSWORD' });
  });

  it('turns network failures into a readable error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('offline'))),
    );
    const err = await api('/api/x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('network_error');
  });
});
