import { describe, expect, it } from 'vitest';
import {
  amortizeExtra,
  applyIndexCorrection,
  balloonSchedule,
  debtInstallmentStatus,
  debtSchedule,
  debtSummary,
  earlyPaymentDiscount,
  fixedSchedule,
  monthlyRateFromAnnual,
  payoffAmount,
  pricePayment,
  priceSchedule,
  roundHalfUp,
  sacSchedule,
  variableSchedule,
  type DebtInstallmentState,
  type ScheduleRow,
} from './index';

const sum = (rows: ScheduleRow[], key: 'amount' | 'principalPart' | 'interestPart') =>
  rows.reduce((a, r) => a + r[key], 0);

describe('helpers (RN 6.1)', () => {
  it('rounds half up', () => {
    expect(roundHalfUp(2.5)).toBe(3);
    expect(roundHalfUp(2.4999)).toBe(2);
    expect(roundHalfUp(2.4999999999)).toBe(3); // ruído de float conta como 2,5
    expect(roundHalfUp(100.49999999999999)).toBe(101);
    expect(roundHalfUp(-2.5)).toBe(-3);
  });

  it('converts annual to monthly rate', () => {
    expect(monthlyRateFromAnnual(0.1268250301)).toBeCloseTo(0.01, 8);
    expect(monthlyRateFromAnnual(0)).toBe(0);
  });
});

describe('fixedSchedule (RN 6.1)', () => {
  it('splits a total with the remainder on the first', () => {
    const rows = fixedSchedule({ firstDueDate: '2026-11-10', installments: 3, total: 10000 });
    expect(rows.map((r) => r.amount)).toEqual([3334, 3333, 3333]);
    expect(rows.map((r) => r.dueDate)).toEqual(['2026-11-10', '2026-12-10', '2027-01-10']);
    expect(rows.map((r) => r.balanceAfter)).toEqual([6666, 3333, 0]);
  });

  it('uses a given installment value', () => {
    const rows = fixedSchedule({ firstDueDate: '2026-01-31', installments: 2, amount: 500 });
    expect(rows.map((r) => [r.dueDate, r.amount])).toEqual([
      ['2026-01-31', 500],
      ['2026-02-28', 500],
    ]);
  });
});

describe('priceSchedule (RN 6.1)', () => {
  const input = {
    principal: 10_000_000,
    monthlyRate: 0.01,
    installments: 12,
    firstDueDate: '2026-11-05',
  };

  it('PMT = PV·i/(1−(1+i)^−n)', () => {
    expect(pricePayment(10_000_000, 0.01, 12)).toBe(888_488);
  });

  it('constant payment, interest on balance, last adjusts to zero', () => {
    const rows = priceSchedule(input);
    expect(rows).toHaveLength(12);
    expect(rows[0]).toMatchObject({
      amount: 888_488,
      interestPart: 100_000,
      principalPart: 788_488,
    });
    expect(rows.slice(0, 11).every((r) => r.amount === 888_488)).toBe(true);
    expect(rows.at(-1)?.balanceAfter).toBe(0);
    expect(sum(rows, 'principalPart')).toBe(10_000_000);
    expect(Math.abs((rows.at(-1)?.amount ?? 0) - 888_488)).toBeLessThan(12);
    for (const r of rows) expect(r.amount).toBe(r.principalPart + r.interestPart);
  });

  it('zero rate', () => {
    const rows = priceSchedule({ ...input, monthlyRate: 0, principal: 1000, installments: 3 });
    expect(rows.map((r) => r.amount)).toEqual([334, 334, 332]);
    expect(sum(rows, 'interestPart')).toBe(0);
  });
});

describe('sacSchedule (RN 6.1)', () => {
  it('constant amortization, decreasing payment', () => {
    const rows = sacSchedule({
      principal: 1_200_000,
      monthlyRate: 0.01,
      installments: 12,
      firstDueDate: '2026-11-05',
    });
    expect(rows[0]).toMatchObject({
      principalPart: 100_000,
      interestPart: 12_000,
      amount: 112_000,
    });
    expect(rows[1]).toMatchObject({
      principalPart: 100_000,
      interestPart: 11_000,
      amount: 111_000,
    });
    expect(rows.at(-1)).toMatchObject({
      principalPart: 100_000,
      interestPart: 1_000,
      balanceAfter: 0,
    });
    expect(sum(rows, 'interestPart')).toBe(78_000);
  });
});

describe('variableSchedule (RN 6.1)', () => {
  it('uses informed values and estimates the rest with the last one', () => {
    const rows = variableSchedule({
      firstDueDate: '2026-11-15',
      lastMonth: '2027-03',
      values: [
        { month: '2026-11', amount: 30000 },
        { month: '2027-01', amount: 32000 },
      ],
    });
    expect(rows.map((r) => [r.dueDate, r.amount, r.estimated ?? false])).toEqual([
      ['2026-11-15', 30000, false],
      ['2026-12-15', 30000, true],
      ['2027-01-15', 32000, false],
      ['2027-02-15', 32000, true],
      ['2027-03-15', 32000, true],
    ]);
    expect(rows.every((r) => r.principalPart === 0)).toBe(true);
  });

  it('requires at least one value', () => {
    expect(() =>
      variableSchedule({ firstDueDate: '2026-11-15', lastMonth: '2027-03', values: [] }),
    ).toThrow(RangeError);
  });
});

describe('balloonSchedule (RN 6.1)', () => {
  it('sorts single payments', () => {
    const rows = balloonSchedule({
      payments: [
        { dueDate: '2027-12-10', amount: 500000 },
        { dueDate: '2026-12-10', amount: 400000 },
      ],
    });
    expect(rows.map((r) => [r.number, r.dueDate, r.balanceAfter])).toEqual([
      [1, '2026-12-10', 500000],
      [2, '2027-12-10', 0],
    ]);
  });
});

describe('applyIndexCorrection (RN 6.2)', () => {
  it('multiplies pending installments by (1 + index)', () => {
    const rows = fixedSchedule({
      firstDueDate: '2026-11-10',
      installments: 3,
      amount: 100000,
    }).slice(1);
    const corrected = applyIndexCorrection(rows, 0.0045);
    expect(corrected.map((r) => r.amount)).toEqual([100450, 100450]);
    expect(corrected.map((r) => r.balanceAfter)).toEqual([100450, 0]);
    expect(applyIndexCorrection([], 0.01)).toEqual([]);
  });

  it('derives balances from the rounded parts (no understatement, no clamp)', () => {
    const rows = fixedSchedule({ firstDueDate: '2026-11-10', installments: 3, amount: 1 });
    const corrected = applyIndexCorrection(rows, 0.5);
    // Cada parte 1,5 → 2; o saldo fecha na soma das partes (6), não em round(3 × 1,5) = 5.
    expect(corrected.map((r) => r.principalPart)).toEqual([2, 2, 2]);
    expect(corrected.map((r) => r.balanceAfter)).toEqual([4, 2, 0]);
  });
});

describe('amortizeExtra (RN 6.5)', () => {
  const base = {
    balance: 1_000_000,
    monthlyRate: 0.01,
    remainingInstallments: 10,
    extra: 300_000,
    nextDueDate: '2027-01-05',
  };

  it('price reduce_installment keeps the term', () => {
    const rows = amortizeExtra({ ...base, system: 'price', mode: 'reduce_installment' });
    expect(rows).toHaveLength(10);
    expect(rows[0]?.amount).toBe(pricePayment(700_000, 0.01, 10));
    expect(rows.at(-1)?.balanceAfter).toBe(0);
  });

  it('price reduce_term keeps the payment and drops installments', () => {
    const payment = pricePayment(1_000_000, 0.01, 10);
    const rows = amortizeExtra({ ...base, system: 'price', mode: 'reduce_term' });
    expect(rows.length).toBeLessThan(10);
    expect(rows.length).toBe(7);
    expect(rows.slice(0, -1).every((r) => r.amount === payment)).toBe(true);
    expect(sum(rows, 'principalPart')).toBe(700_000);
  });

  it('sac modes', () => {
    const term = amortizeExtra({ ...base, system: 'sac', mode: 'reduce_term' });
    expect(term).toHaveLength(7);
    expect(term.every((r) => r.principalPart === 100_000)).toBe(true);
    const inst = amortizeExtra({ ...base, system: 'sac', mode: 'reduce_installment' });
    expect(inst).toHaveLength(10);
    expect(inst[0]?.principalPart).toBe(70_000);
  });

  it('sac reduce_term keeps the pending amortizations, remainder on the first', () => {
    const rows = amortizeExtra({
      ...base,
      balance: 10_001,
      remainingInstallments: 3,
      extra: 3_000,
      system: 'sac',
      mode: 'reduce_term',
    });
    expect(rows.map((r) => r.principalPart)).toEqual([3_335, 3_333, 333]);
    expect(rows.at(-1)?.balanceAfter).toBe(0);
  });

  it('paying the whole balance leaves nothing; validates extra', () => {
    expect(
      amortizeExtra({ ...base, extra: 1_000_000, system: 'price', mode: 'reduce_term' }),
    ).toEqual([]);
    expect(() => amortizeExtra({ ...base, extra: 0, system: 'sac', mode: 'reduce_term' })).toThrow(
      RangeError,
    );
    expect(() =>
      amortizeExtra({ ...base, extra: 2_000_000, system: 'sac', mode: 'reduce_term' }),
    ).toThrow(RangeError);
  });
});

describe('earlyPaymentDiscount (RN 6.5)', () => {
  it('present value, floored', () => {
    expect(earlyPaymentDiscount(10000, 0.02, 4)).toBe(761);
    expect(earlyPaymentDiscount(10000, 0.02, 0)).toBe(0);
    // 0,9999999999 → 0: nunca arredonda um centavo para cima.
    expect(earlyPaymentDiscount(10000000000, 1e-10, 1)).toBe(0);
  });
});

const state = (rows: ScheduleRow[], paidUpTo: number): DebtInstallmentState[] =>
  rows.map((r, i) => ({
    dueDate: r.dueDate,
    amount: r.amount,
    principalPart: r.principalPart,
    interestPart: r.interestPart,
    paidAmount: i < paidUpTo ? r.amount : 0,
    paid: i < paidUpTo,
  }));

describe('debt status, payoff and summary (RN 6.3, 6.4)', () => {
  const rows = sacSchedule({
    principal: 1_200_000,
    monthlyRate: 0.01,
    installments: 12,
    firstDueDate: '2026-01-05',
  });

  it('installment status', () => {
    const [a, b] = state(rows, 1);
    expect(debtInstallmentStatus(a as DebtInstallmentState, '2026-03-01')).toBe('paid');
    expect(debtInstallmentStatus(b as DebtInstallmentState, '2026-03-01')).toBe('late');
    expect(debtInstallmentStatus(b as DebtInstallmentState, '2026-02-05')).toBe('pending');
    expect(
      debtInstallmentStatus({ ...(b as DebtInstallmentState), paidAmount: 10 }, '2026-03-01'),
    ).toBe('partial');
  });

  it('payoff = outstanding principal', () => {
    expect(payoffAmount(state(rows, 4))).toBe(800_000);
  });

  it('summary', () => {
    const s = debtSummary(state(rows, 4), '2026-05-10');
    expect(s).toMatchObject({
      totalCount: 12,
      paidCount: 4,
      remainingCount: 8,
      paidAmount: 112_000 + 111_000 + 110_000 + 109_000,
      outstandingPrincipal: 800_000,
      interestPaid: 12_000 + 11_000 + 10_000 + 9_000,
      interestToPay: 36_000,
      expectedPayoffDate: '2026-12-05',
      lateCount: 1,
      lateAmount: 108_000,
    });
    expect(s.remainingAmount).toBe(800_000 + 36_000);
    expect(s.progressByCount).toBeCloseTo(4 / 12);
  });
});

describe('debtSchedule: imóvel na planta (RN 6.7)', () => {
  const phases = [
    { system: 'fixed' as const, firstDueDate: '2026-11-10', installments: 3, amount: 200000 },
    { system: 'balloon' as const, payments: [{ dueDate: '2026-12-20', amount: 1000000 }] },
    {
      system: 'variable' as const,
      firstDueDate: '2026-11-15',
      endsAtCompletion: true,
      values: [{ month: '2026-11', amount: 50000 }],
    },
    {
      system: 'price' as const,
      startsAfterCompletion: true,
      principal: 20_000_000,
      monthlyRate: 0.008,
      installments: 360,
      firstDueDate: '2000-01-05',
    },
  ];

  it('combines phases in due date order and starts financing after completion', () => {
    const rows = debtSchedule(phases, '2027-01-20');
    expect(rows.slice(0, 7).map((r) => [r.number, r.dueDate, r.phase])).toEqual([
      [1, '2026-11-10', 0],
      [2, '2026-11-15', 2],
      [3, '2026-12-10', 0],
      [4, '2026-12-15', 2],
      [5, '2026-12-20', 1],
      [6, '2027-01-10', 0],
      [7, '2027-01-15', 2],
    ]);
    const financing = rows.filter((r) => r.phase === 3);
    expect(financing).toHaveLength(360);
    expect(financing[0]?.dueDate).toBe('2027-02-05');
    expect(rows.at(-1)?.number).toBe(rows.length);
  });

  it('moving the completion date extends construction interest and shifts financing', () => {
    const rows = debtSchedule(phases, '2027-04-02');
    expect(rows.filter((r) => r.phase === 2)).toHaveLength(6); // nov..abr
    expect(rows.find((r) => r.phase === 3)?.dueDate).toBe('2027-05-05');
  });

  it('requires a completion date for dependent phases', () => {
    expect(() => debtSchedule(phases)).toThrow(RangeError);
  });
});
