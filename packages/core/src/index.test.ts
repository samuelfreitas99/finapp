import { describe, expect, it } from 'vitest';
import { isCents } from './index';

describe('isCents', () => {
  it('accepts safe integers', () => {
    expect(isCents(0)).toBe(true);
    expect(isCents(-1050)).toBe(true);
  });

  it('rejects floats and non-numbers', () => {
    expect(isCents(10.5)).toBe(false);
    expect(isCents('100')).toBe(false);
    expect(isCents(Number.MAX_SAFE_INTEGER + 1)).toBe(false);
  });
});
