import { describe, expect, it } from 'vitest';
import {
  hasNearbyMatch,
  importKeys,
  matchCategoryRule,
  parseCSVStatement,
  parseOFX,
  parseStatementAmount,
  parseStatementDate,
  isInvoicePaymentLine,
  reconcileStatement,
  suggestRulePattern,
} from './index';

describe('parseStatementAmount', () => {
  it.each([
    ['1.234,56', 123456],
    ['-1234.56', -123456],
    ['R$ 10', 1000],
    ['1,234.56', 123456],
    ['(25,90)', -2590],
    ['-3,9', -390],
    ['12.5', 1250],
    ['1.234', 123400],
    ['+0,07', 7],
    ['0', 0],
  ])('%s → %i', (input, expected) => expect(parseStatementAmount(input)).toBe(expected));

  it('rejects text', () => {
    expect(parseStatementAmount('abc')).toBeNull();
    expect(parseStatementAmount('')).toBeNull();
    expect(parseStatementAmount('1,234,5678')).toBeNull();
  });
});

describe('parseStatementDate', () => {
  it('reads common formats and rejects impossible dates', () => {
    expect(parseStatementDate('05/10/2026')).toBe('2026-10-05');
    expect(parseStatementDate('5/10/26')).toBe('2026-10-05');
    expect(parseStatementDate('2026-10-05')).toBe('2026-10-05');
    expect(parseStatementDate('20261005120000[-3:BRT]')).toBe('2026-10-05');
    expect(parseStatementDate('31/02/2026')).toBeNull();
    expect(parseStatementDate('ontem')).toBeNull();
  });
});

const OFX_SGML = `OFXHEADER:100
DATA:OFXSGML
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20261003120000[-3:BRT]
<TRNAMT>-45,90
<FITID>abc123
<MEMO>COMPRA MERCADO SOL
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20261005
<TRNAMT>3500.00
<FITID>def456
<NAME>SALARIO
<MEMO>Pagamento &amp; bonus
</STMTTRN>
<STMTTRN>
<DTPOSTED>20261006
<TRNAMT>0.00
<FITID>zero
<MEMO>ignorar
</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

describe('parseOFX', () => {
  it('reads SGML statements without closing tags', () => {
    const r = parseOFX(OFX_SGML);
    expect(r.error).toBeNull();
    expect(r.entries).toEqual([
      { date: '2026-10-03', amount: -4590, description: 'COMPRA MERCADO SOL', fitId: 'abc123' },
      {
        date: '2026-10-05',
        amount: 350000,
        description: 'SALARIO Pagamento & bonus',
        fitId: 'def456',
      },
    ]);
  });

  it('reports files without transactions', () => {
    expect(parseOFX('<OFX></OFX>').error).toMatch(/Não encontrei/);
  });
});

describe('parseCSVStatement', () => {
  it('reads a Brazilian bank CSV (semicolon, comma decimals, quotes)', () => {
    const csv = [
      '﻿Data;Histórico;Valor',
      '03/10/2026;"PIX; JOAO";-120,50',
      '05/10/2026;Salário;3.500,00',
      'sem data;lixo;1,00',
    ].join('\n');
    const r = parseCSVStatement(csv);
    expect(r.entries).toEqual([
      { date: '2026-10-03', amount: -12050, description: 'PIX; JOAO', fitId: null },
      { date: '2026-10-05', amount: 350000, description: 'Salário', fitId: null },
    ]);
  });

  it('reads separate debit and credit columns and inverts on request', () => {
    const csv = 'Data,Descrição,Débito,Crédito\n2026-10-03,Luz,150.00,\n2026-10-04,Freela,,800.00';
    expect(parseCSVStatement(csv).entries.map((e) => e.amount)).toEqual([-15000, 80000]);
    const inverted = 'date,description,amount\n2026-10-03,Café,12.00';
    expect(parseCSVStatement(inverted, { invert: true }).entries[0]?.amount).toBe(-1200);
  });

  it('explains unknown layouts', () => {
    const r = parseCSVStatement('foo;bar\n1;2');
    expect(r.error).toMatch(/Não reconheci as colunas/);
    expect(r.error).toMatch(/foo, bar/);
  });
});

describe('importKeys', () => {
  it('uses FITID, and counts identical entries without it', () => {
    const e = { date: '2026-10-03', amount: -500, description: 'Café  Bom', fitId: null };
    expect(importKeys([{ ...e, fitId: 'X1' }, e, e])).toEqual([
      'fit:X1',
      '2026-10-03|-500|cafe bom#1',
      '2026-10-03|-500|cafe bom#2',
    ]);
  });
});

describe('category rules', () => {
  const rules = [
    { id: '1', pattern: 'mercado', categoryId: 'mercado' },
    { id: '2', pattern: 'mercado livre', categoryId: 'compras' },
  ];

  it('prefers the longest matching pattern, ignoring case and accents', () => {
    expect(matchCategoryRule('COMPRA MERCADO LIVRE 123', rules)?.categoryId).toBe('compras');
    expect(matchCategoryRule('Supermercado Sol', rules)?.categoryId).toBe('mercado');
    expect(matchCategoryRule('Padaria', rules)).toBeNull();
  });

  it('suggests a short pattern without numbers', () => {
    expect(suggestRulePattern('Pix Mercado Sol 12345 SP')).toBe('pix mercado sol');
    expect(suggestRulePattern('Café do Zé')).toBe('cafe do ze');
  });
});

describe('hasNearbyMatch', () => {
  it('finds the same amount within the tolerance', () => {
    const existing = [{ date: '2026-10-03', amount: -4590 }];
    expect(hasNearbyMatch({ date: '2026-10-05', amount: -4590 }, existing)).toBe(true);
    expect(hasNearbyMatch({ date: '2026-10-06', amount: -4590 }, existing)).toBe(false);
    expect(hasNearbyMatch({ date: '2026-10-03', amount: -4000 }, existing)).toBe(false);
  });
});

describe('reconcileStatement', () => {
  const c = (
    id: string,
    date: string,
    amount: number,
    status: 'planned' | 'settled',
    extra: Partial<{ estimated: boolean; imported: boolean }> = {},
  ) => ({ id, date, amount, status, estimated: false, imported: false, ...extra });

  it('confirms a planned salary that arrived a few days early', () => {
    const out = reconcileStatement(
      [{ date: '2026-10-03', amount: 500000 }],
      [c('salario', '2026-10-07', 500000, 'planned')],
    );
    expect(out).toEqual([{ id: 'salario', kind: 'planned' }]);
  });

  it('accepts a different amount only for estimated planned items', () => {
    const luz = c('luz', '2026-10-10', -20000, 'planned', { estimated: true });
    const aluguel = c('aluguel', '2026-10-10', -150000, 'planned');
    expect(
      reconcileStatement(
        [
          { date: '2026-10-10', amount: -23500 },
          { date: '2026-10-10', amount: -150100 },
        ],
        [luz, aluguel],
      ),
    ).toEqual([{ id: 'luz', kind: 'planned' }, null]);
    // 40% a mais já não é a mesma conta.
    expect(reconcileStatement([{ date: '2026-10-10', amount: -28000 }], [luz])).toEqual([null]);
  });

  it('links a manual entry instead of creating it again, and flags old imports', () => {
    const out = reconcileStatement(
      [
        { date: '2026-10-02', amount: -5290 },
        { date: '2026-10-05', amount: -1000 },
      ],
      [
        c('mercado', '2026-10-01', -5290, 'settled'),
        c('cafe', '2026-10-05', -1000, 'settled', { imported: true }),
      ],
    );
    expect(out).toEqual([
      { id: 'mercado', kind: 'settled' },
      { id: 'cafe', kind: 'possible' },
    ]);
  });

  it('prefers the manual entry over the planned one, and uses each only once', () => {
    const out = reconcileStatement(
      [
        { date: '2026-10-10', amount: -9990 },
        { date: '2026-10-10', amount: -9990 },
        { date: '2026-10-10', amount: -9990 },
      ],
      [c('previsto', '2026-10-10', -9990, 'planned'), c('manual', '2026-10-09', -9990, 'settled')],
    );
    expect(out).toEqual([
      { id: 'manual', kind: 'settled' },
      { id: 'previsto', kind: 'planned' },
      null,
    ]);
  });

  it('never matches income with expense or far dates', () => {
    expect(
      reconcileStatement(
        [{ date: '2026-10-10', amount: 5000 }],
        [c('saida', '2026-10-10', -5000, 'settled'), c('longe', '2026-10-25', 5000, 'planned')],
      ),
    ).toEqual([null]);
  });
});

describe('card invoice helpers', () => {
  it('reads the Nubank card CSV (date,title,amount) and spots the invoice payment', () => {
    const csv =
      'date,title,amount\n2026-09-28,Mercado Sol,52.90\n2026-09-30,Pagamento recebido,-1200.00';
    const parsed = parseCSVStatement(csv, { invert: true });
    expect(parsed.entries.map((e) => [e.description, e.amount])).toEqual([
      ['Mercado Sol', -5290],
      ['Pagamento recebido', 120000],
    ]);
    expect(isInvoicePaymentLine('Pagamento recebido', 120000)).toBe(true);
    expect(isInvoicePaymentLine('Estorno Mercado', 5290)).toBe(false);
    expect(isInvoicePaymentLine('Pagamento recebido', -100)).toBe(false);
  });

  it('matches by amount inside the invoice, whatever the date', () => {
    const out = reconcileStatement(
      [{ date: '2026-03-10', amount: -10000 }],
      [
        {
          id: 'parcela',
          date: '2026-09-10',
          amount: -10000,
          status: 'settled',
          estimated: false,
          imported: false,
        },
      ],
      { plannedDays: Infinity, settledDays: Infinity },
    );
    expect(out).toEqual([{ id: 'parcela', kind: 'settled' }]);
  });
});
