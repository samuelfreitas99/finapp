import { describe, expect, it } from 'vitest';
import { healthResponseSchema } from './health';

describe('healthResponseSchema', () => {
  it('accepts a valid payload', () => {
    const payload = { status: 'ok', time: new Date().toISOString() };
    expect(healthResponseSchema.parse(payload)).toEqual(payload);
  });

  it('rejects an invalid payload', () => {
    expect(healthResponseSchema.safeParse({ status: 'down' }).success).toBe(false);
  });
});
