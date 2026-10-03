import { describe, expect, it } from 'vitest';
import {
  hasNearbyMatch,
  importKeys,
  matchCategoryRule,
  parseCSVStatement,
  parseOFX,
  parseStatementAmount,
  parseStatementDate,
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
