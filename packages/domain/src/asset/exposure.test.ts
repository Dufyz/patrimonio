import { describe, expect, it } from 'vitest';

import { exposureClassOf } from './exposure.js';

describe('EST-02 · exposureClassOf', () => {
  it.each([
    ['stock', null, 'acoes_brasil'],
    ['bdr', null, 'acoes_exterior'],
    ['fii', null, 'fiis'],
    ['treasury', null, 'renda_fixa'],
    ['fixed_income', null, 'renda_fixa'],
    ['etf', 'acoes_brasil', 'acoes_brasil'],
    ['etf', 'renda_fixa', 'renda_fixa'],
    ['etf', 'acoes_exterior', 'acoes_exterior'],
    ['etf', null, 'outros'],
    [null, null, 'outros'],
  ] as const)('%s + %s → %s', (type, exposure, expected) => {
    expect(exposureClassOf(type, exposure)).toBe(expected);
  });
});
