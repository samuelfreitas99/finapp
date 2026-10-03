import { describe, expect, it } from 'vitest';
import { nextReminderAt } from './index';

describe('nextReminderAt', () => {
  it('advances keeping the time, clamping short months', () => {
    expect(nextReminderAt('2026-10-15T12:00:00.000Z', 'daily')).toBe('2026-10-16T12:00:00.000Z');
    expect(nextReminderAt('2026-10-15T12:00:00.000Z', 'weekly')).toBe('2026-10-22T12:00:00.000Z');
    expect(nextReminderAt('2026-01-31T12:00:00.000Z', 'monthly')).toBe('2026-02-28T12:00:00.000Z');
    expect(nextReminderAt('2026-10-15T12:00:00.000Z', 'yearly')).toBe('2027-10-15T12:00:00.000Z');
    expect(nextReminderAt('2026-10-15T12:00:00.000Z', 'none')).toBeNull();
  });
});
