import { describe, expect, it } from 'vitest';
import { planBody, type EntryState } from './EntryForm';

const base: EntryState = {
  kind: 'expense',
  amount: 15000,
  categoryId: null,
  description: 'Geladeira',
  accountId: 'acc',
  toAccountId: '',
  date: '2026-10-03',
  done: true,
  pix: false,
  pixCounterparty: '',
  notes: '',
  installments: 10,
  firstDueDate: '2026-11-10',
  adjust: 'none',
};

describe('planBody (RN 5.3)', () => {
  it('new purchase: total amount from the 1st installment', () => {
    expect(planBody(base, 'card-1')).toEqual({
      cardId: 'card-1',
      totalAmount: 15000,
      installments: 10,
      firstDate: '2026-10-03',
      startInstallment: 1,
    });
  });

  it('ongoing on a card: installment value and the purchase date moved back', () => {
    const body = planBody({ ...base, ongoing: true, currentInstallment: 4 }, 'card-1');
    expect(body).toMatchObject({
      installmentAmount: 15000,
      startInstallment: 4,
      firstDate: '2026-07-03',
    });
    expect(body).not.toHaveProperty('totalAmount');
  });

  it('ongoing booklet: the informed due date is of the current installment', () => {
    expect(
      planBody({ ...base, ongoing: true, currentInstallment: 3, amountIs: 'total' }, null),
    ).toMatchObject({
      accountId: 'acc',
      totalAmount: 15000,
      firstDueDate: '2026-09-10',
      startInstallment: 3,
    });
  });
});
