import { describe, expect, it } from 'vitest';
import { centsToDecimal, csvCell, toCSV } from './index';

describe('centsToDecimal', () => {
  it('formats reais with comma', () => {
    expect(centsToDecimal(123456)).toBe('1234,56');
    expect(centsToDecimal(-5)).toBe('-0,05');
    expect(centsToDecimal(0)).toBe('0,00');
  });
});

describe('csvCell', () => {
  it('quotes delimiters, quotes and line breaks', () => {
    expect(csvCell('a;b')).toBe('"a;b"');
    expect(csvCell('diz "oi"')).toBe('"diz ""oi"""');
    expect(csvCell('linha\nnova')).toBe('"linha\nnova"');
    expect(csvCell(null)).toBe('');
    expect(csvCell(true)).toBe('true');
  });

  it('neutralizes spreadsheet formulas', () => {
    expect(csvCell('=SOMA(A1)')).toBe("'=SOMA(A1)");
    expect(csvCell('@cmd')).toBe("'@cmd");
    expect(csvCell(-5)).toBe('-5');
  });
});

describe('toCSV', () => {
  it('writes BOM, header and CRLF rows', () => {
    expect(toCSV(['a', 'b'], [[1, 'x;y']])).toBe('﻿a;b\r\n1;"x;y"\r\n');
  });
});
