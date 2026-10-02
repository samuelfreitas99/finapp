import { assertCents, type Cents } from '../money';

/**
 * Divisão de despesas (casal no espaço compartilhado e racha entre amigos): partes de
 * cada participante, saldos e simplificação de dívidas.
 * @see RN 10, RN 11
 */

export type SplitMode = 'equal' | 'percent' | 'amount' | 'shares';

export interface SplitParticipant {
  id: string;
  /** Modo `percent`: 0–100, até 2 casas. */
  percent?: number;
  /** Modo `amount`: valor da parte. */
  amount?: Cents;
  /** Modo `shares`: peso (inteiro > 0, ex.: 2 cotas). */
  weight?: number;
}

export interface SplitShare {
  id: string;
  amount: Cents;
}

/**
 * Parte de cada participante numa despesa. Nos modos proporcionais cada parte é
 * arredondada para baixo e **o resto vai para quem pagou** (`payerId`, se participa;
 * senão, o primeiro participante). No modo `amount` as partes precisam somar o total.
 * @see RN 10, RN 11
 */
export function splitExpense(
  total: Cents,
  mode: SplitMode,
  participants: readonly SplitParticipant[],
  payerId?: string,
): SplitShare[] {
  assertCents(total, 'total');
  if (total < 0) throw new RangeError('total deve ser >= 0');
  if (participants.length === 0) throw new RangeError('informe ao menos um participante');
  if (new Set(participants.map((p) => p.id)).size !== participants.length) {
    throw new RangeError('participantes repetidos');
  }
  let amounts: number[];
  switch (mode) {
    case 'equal':
      amounts = participants.map(() => Math.floor(total / participants.length));
      break;
    case 'percent': {
      const points = participants.map((p) => {
        if (p.percent === undefined || !(p.percent >= 0))
          throw new RangeError(`percent inválido para ${p.id}`);
        return Math.round(p.percent * 100);
      });
      if (points.reduce((a, b) => a + b, 0) !== 10000)
        throw new RangeError('a soma dos percentuais deve ser 100');
      amounts = points.map((pt) => Math.floor((total * pt) / 10000));
      break;
    }
    case 'shares': {
      const weights = participants.map((p) => {
        if (!Number.isInteger(p.weight) || (p.weight as number) < 1) {
          throw new RangeError(`weight inválido para ${p.id}`);
        }
        return p.weight as number;
      });
      const sum = weights.reduce((a, b) => a + b, 0);
      amounts = weights.map((w) => Math.floor((total * w) / sum));
      break;
    }
    case 'amount': {
      amounts = participants.map((p) => {
        assertCents(p.amount, `parte de ${p.id}`);
        return p.amount as Cents;
      });
      if (amounts.reduce((a, b) => a + b, 0) !== total)
        throw new RangeError('as partes devem somar o total');
      break;
    }
  }
  const remainder = total - amounts.reduce((a, b) => a + b, 0);
  if (remainder !== 0) {
    const idx = Math.max(
      0,
      participants.findIndex((p) => p.id === payerId),
    );
    amounts[idx] = (amounts[idx] as number) + remainder;
  }
  return participants.map((p, i) => ({ id: p.id, amount: amounts[i] as Cents }));
}

export interface GroupExpense {
  /** Quem pagou e quanto (pode ser mais de um). */
  payers: readonly SplitShare[];
  /** Quanto cada participante deve (resultado de `splitExpense`). */
  shares: readonly SplitShare[];
}

export interface Settlement {
  from: string;
  to: string;
  amount: Cents;
}

/**
 * Saldo de cada participante: `pagou − deve`, ajustado pelos acertos (quem pagou um
 * acerto aumenta o saldo; quem recebeu diminui). Positivo = tem a receber.
 * @see RN 11 (Saldo)
 */
export function groupBalances(
  expenses: readonly GroupExpense[],
  settlements: readonly Settlement[] = [],
): Map<string, Cents> {
  const balances = new Map<string, Cents>();
  const add = (id: string, value: Cents) => balances.set(id, (balances.get(id) ?? 0) + value);
  for (const e of expenses) {
    const paid = e.payers.reduce((a, p) => a + p.amount, 0);
    const owed = e.shares.reduce((a, s) => a + s.amount, 0);
    if (paid !== owed)
      throw new RangeError(`despesa com pagamentos (${paid}) diferentes das partes (${owed})`);
    for (const p of e.payers) {
      assertCents(p.amount, 'pagamento');
      add(p.id, p.amount);
    }
    for (const s of e.shares) {
      assertCents(s.amount, 'parte');
      add(s.id, -s.amount);
    }
  }
  for (const s of settlements) {
    assertCents(s.amount, 'acerto');
    if (s.amount <= 0) throw new RangeError('acerto deve ser > 0');
    add(s.from, s.amount);
    add(s.to, -s.amount);
  }
  return balances;
}

/**
 * Simplifica as dívidas do grupo: guloso, casa o maior devedor com o maior credor até
 * zerar, minimizando o número de pagamentos. Empates resolvidos pelo id, para o
 * resultado ser determinístico.
 * @see RN 11 (Simplificar dívidas)
 */
export function simplifyDebts(balances: ReadonlyMap<string, Cents>): Settlement[] {
  for (const [id, v] of balances) assertCents(v, `saldo de ${id}`);
  const total = [...balances.values()].reduce((a, b) => a + b, 0);
  if (total !== 0) throw new RangeError(`saldos não fecham em zero (${total})`);
  const creditors = [...balances].filter(([, v]) => v > 0).map(([id, v]) => ({ id, v }));
  const debtors = [...balances].filter(([, v]) => v < 0).map(([id, v]) => ({ id, v: -v }));
  const byAmount = (a: { id: string; v: number }, b: { id: string; v: number }) =>
    b.v - a.v || a.id.localeCompare(b.id);
  const result: Settlement[] = [];
  while (creditors.length && debtors.length) {
    creditors.sort(byAmount);
    debtors.sort(byAmount);
    const c = creditors[0] as { id: string; v: number };
    const d = debtors[0] as { id: string; v: number };
    const amount = Math.min(c.v, d.v);
    result.push({ from: d.id, to: c.id, amount });
    c.v -= amount;
    d.v -= amount;
    if (c.v === 0) creditors.shift();
    if (d.v === 0) debtors.shift();
  }
  return result;
}
