import { describe, expect, it } from 'vitest';
import { goalProgress } from './index';

const base = { targetAmount: 1200000, saved: 0, targetDate: '2027-10-15', today: '2026-10-15' };

describe('goalProgress (RN 8)', () => {
  it('suggests (target - saved) / months left, rounding up', () => {
    const p = goalProgress({ ...base, saved: 200000 });
    expect(p).toMatchObject({
      remaining: 1000000,
      monthsLeft: 12,
      suggestedMonthly: 83334,
      status: 'on_track',
    });
    expect(p.ratio).toBeCloseTo(1 / 6);
  });

  it('counts the current month when the target is this month', () => {
    const p = goalProgress({ ...base, targetDate: '2026-10-31' });
    expect(p.monthsLeft).toBe(1);
    expect(p.suggestedMonthly).toBe(1200000);
  });

  it('is done when saved reaches the target', () => {
    expect(goalProgress({ ...base, saved: 1500000 })).toMatchObject({
      status: 'done',
      remaining: 0,
      ratio: 1,
      suggestedMonthly: 0,
    });
  });

  it('has no suggestion without a date, and asks for everything when overdue', () => {
    expect(goalProgress({ ...base, targetDate: null })).toMatchObject({
      status: 'no_date',
      suggestedMonthly: null,
    });
    expect(goalProgress({ ...base, saved: 200000, targetDate: '2026-09-30' })).toMatchObject({
      status: 'overdue',
      suggestedMonthly: 1000000,
    });
  });

  it('ignores a negative saved balance', () => {
    expect(goalProgress({ ...base, saved: -5000 }).saved).toBe(0);
  });
});
