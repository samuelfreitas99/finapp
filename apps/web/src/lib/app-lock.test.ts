import { describe, expect, it } from 'vitest';
import { shouldAutoLock } from './app-lock';

describe('shouldAutoLock', () => {
  it('locks only after the app stayed hidden long enough', () => {
    expect(shouldAutoLock(0, 59_999)).toBe(false);
    expect(shouldAutoLock(0, 60_000)).toBe(true);
  });
});
