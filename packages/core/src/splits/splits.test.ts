import { describe, expect, it } from 'vitest';
import { groupBalances, simplifyDebts, splitExpense } from './index';

const abc = [{ id: 'ana' }, { id: 'bia' }, { id: 'caio' }];

describe('splitExpense (RN 10, 11)', () => {
  it('equal: remainder goes to the payer', () => {
    expect(splitExpense(10000, 'equal', abc, 'bia')).toEqual([
      { id: 'ana', amount: 3333 },
      { id: 'bia', amount: 3334 },
      { id: 'caio', amount: 3333 },
    ]);
  });

  it('remainder goes to the first participant when the payer is not included', () => {
    expect(splitExpense(10000, 'equal', abc, 'zé').map((s) => s.amount)).toEqual([
      3334, 3333, 3333,
    ]);
  });

  it('percent (casal 60/40)', () => {
    const couple = [
      { id: 'samuel', percent: 60 },
      { id: 'ana', percent: 40 },
    ];
    expect(splitExpense(12345, 'percent', couple, 'ana')).toEqual([
      { id: 'samuel', amount: 7407 },
      { id: 'ana', amount: 4938 },
    ]);
    expect(() => splitExpense(100, 'percent', [{ id: 'a', percent: 50 }])).toThrow(RangeError);
  });

  it('shares', () => {
    const parts = [
      { id: 'ana', weight: 2 },
      { id: 'bia', weight: 1 },
    ];
    expect(splitExpense(1000, 'shares', parts, 'ana').map((s) => s.amount)).toEqual([667, 333]);
    expect(() => splitExpense(1000, 'shares', [{ id: 'a', weight: 0 }])).toThrow(RangeError);
  });

  it('amount must sum to the total', () => {
    const parts = [
      { id: 'ana', amount: 700 },
      { id: 'bia', amount: 300 },
    ];
    expect(splitExpense(1000, 'amount', parts).map((s) => s.amount)).toEqual([700, 300]);
    expect(() => splitExpense(999, 'amount', parts)).toThrow(RangeError);
  });

  it('validates participants', () => {
    expect(() => splitExpense(100, 'equal', [])).toThrow(RangeError);
    expect(() => splitExpense(100, 'equal', [{ id: 'a' }, { id: 'a' }])).toThrow(RangeError);
  });
});

describe('groupBalances (RN 11)', () => {
  it('paid minus owed, adjusted by settlements', () => {
    const dinner = {
      payers: [{ id: 'ana', amount: 9000 }],
      shares: splitExpense(9000, 'equal', abc, 'ana'),
    };
    const uber = {
      payers: [
        { id: 'bia', amount: 2000 },
        { id: 'caio', amount: 1000 },
      ],
      shares: splitExpense(3000, 'equal', abc, 'bia'),
    };
    const b = groupBalances([dinner, uber]);
    expect(Object.fromEntries(b)).toEqual({ ana: 5000, bia: -2000, caio: -3000 });
    const after = groupBalances([dinner, uber], [{ from: 'caio', to: 'ana', amount: 3000 }]);
    expect(Object.fromEntries(after)).toEqual({ ana: 2000, bia: -2000, caio: 0 });
  });

  it('rejects inconsistent expenses', () => {
    expect(() =>
      groupBalances([{ payers: [{ id: 'a', amount: 10 }], shares: [{ id: 'b', amount: 9 }] }]),
    ).toThrow(RangeError);
  });
});

describe('simplifyDebts (RN 11)', () => {
  it('matches largest debtors with largest creditors', () => {
    const balances = new Map([
      ['ana', 6000],
      ['bia', -1000],
      ['caio', -4000],
      ['duda', 1000],
      ['edu', -2000],
    ]);
    expect(simplifyDebts(balances)).toEqual([
      { from: 'caio', to: 'ana', amount: 4000 },
      { from: 'edu', to: 'ana', amount: 2000 },
      { from: 'bia', to: 'duda', amount: 1000 },
    ]);
  });

  it('returns nothing when everyone is settled and rejects unbalanced input', () => {
    expect(simplifyDebts(new Map([['a', 0]]))).toEqual([]);
    expect(() => simplifyDebts(new Map([['a', 10]]))).toThrow(RangeError);
  });
});
