import { describe, expect, it } from 'vitest';
import { typedCents } from './money-input';

describe('typedCents', () => {
  it('pushes digits from the right', () => {
    expect(typedCents(0, 'R$ 0,001', false)).toBe(1);
    expect(typedCents(1234, 'R$ 12,345', false)).toBe(12345);
    expect(typedCents(12345, 'R$ 123,4', false)).toBe(1234); // backspace
  });

  it('replaces a suggested value on the first keystroke', () => {
    expect(typedCents(18000, 'R$ 180,002', true)).toBe(2);
    expect(typedCents(18000, 'R$ 180,002', false)).toBe(180002);
    // Apagar não é "digitar por cima": segue normal.
    expect(typedCents(18000, 'R$ 180,0', true)).toBe(1800);
  });

  it('caps the number of digits', () => {
    expect(typedCents(0, '9'.repeat(20), false)).toBe(9_999_999_999_999);
  });
});
