import { describe, expect, it } from 'vitest';
import { bcbWindow, parseBcbSeries, parseIbgeSeries, percentToDecimal } from './index';

describe('percentToDecimal', () => {
  it('converts percent text to a decimal rate', () => {
    expect(percentToDecimal('0.48')).toBe(0.0048);
    expect(percentToDecimal('-0,32')).toBe(-0.0032);
    expect(percentToDecimal(1.2)).toBe(0.012);
    expect(percentToDecimal('abc')).toBeNull();
    expect(percentToDecimal('150')).toBeNull();
  });
});

describe('parseBcbSeries', () => {
  it('reads the SGS format and ignores bad rows', () => {
    const rows = parseBcbSeries([
      { data: '01/08/2026', valor: '0.07' },
      { data: '01/09/2026', valor: '0.48' },
      { data: 'lixo', valor: '1' },
      { data: '01/10/2026', valor: 'x' },
      { data: '01/09/2026', valor: '0.50' },
    ]);
    expect(rows).toEqual([
      { month: '2026-08', value: 0.0007 },
      { month: '2026-09', value: 0.005 },
    ]);
    expect(parseBcbSeries({ erro: true })).toEqual([]);
  });
});

describe('parseIbgeSeries', () => {
  it('reads the SIDRA format', () => {
    const json = [
      {
        resultados: [
          { series: [{ serie: { '202607': '0.07', '202606': '0.16', '202608': '-0.32' } }] },
        ],
      },
    ];
    expect(parseIbgeSeries(json)).toEqual([
      { month: '2026-06', value: 0.0016 },
      { month: '2026-07', value: 0.0007 },
      { month: '2026-08', value: -0.0032 },
    ]);
    expect(parseIbgeSeries([])).toEqual([]);
    expect(parseIbgeSeries(null)).toEqual([]);
  });
});

describe('bcbWindow', () => {
  it('goes back whole months and crosses the year', () => {
    expect(bcbWindow('2026-10-03', 6)).toEqual({ from: '01/04/2026', to: '03/10/2026' });
    expect(bcbWindow('2026-02-15', 4)).toEqual({ from: '01/10/2025', to: '15/02/2026' });
  });
});
