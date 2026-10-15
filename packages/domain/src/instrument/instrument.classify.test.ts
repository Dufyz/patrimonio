import { describe, expect, it } from 'vitest';

import { classifyListedInstrument } from './instrument.classify.js';

describe('classifyListedInstrument', () => {
  it.each([
    ['02', 'ON  NM', 'stock'],
    ['02', 'PN  N1', 'stock'],
    ['02', 'PNA N1', 'stock'],
    ['02', 'UNT N2', 'stock'],
    ['02', 'DRN', 'bdr'],
    ['02', 'DR3', 'bdr'],
    ['02', 'CI', 'etf'],
    ['14', 'CI', 'etf'],
    ['14', 'CI  ER', 'etf'],
    ['34', 'DRN', 'bdr'],
    ['34', 'DRN ED', 'bdr'],
    ['35', 'DR1', 'bdr'],
    ['36', 'DRE', 'bdr'],
    ['08', 'ON', 'stock'],
    ['07', 'ON  NM', 'stock'],
    ['12', 'CI', 'fii'],
    ['12', 'CI ER', 'fii'],
  ] as const)('grupo %s e espécie "%s" é %s', (codbdi, especi, expected) => {
    expect(classifyListedInstrument({ codbdi, especi })).toBe(expected);
  });

  it.each([
    ['96', 'ON  NM'],
    ['78', 'ON'],
    ['62', 'ON'],
    ['13', 'DIR'],
    ['14', 'ON'],
    ['34', 'ON'],
    ['22', 'BNS ORD NM'],
    ['10', 'DIR ORD NM'],
    ['13', 'CI'],
    ['14', ''],
    ['02', 'XYZ'],
    ['02', ''],
  ] as const)('grupo %s e espécie "%s" fica fora do catálogo', (codbdi, especi) => {
    expect(classifyListedInstrument({ codbdi, especi })).toBeNull();
  });
});
