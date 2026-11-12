import { describe, expect, it } from 'vitest';

import {
  againstDeadline,
  decodeBudget,
  decodeCascade,
  parseBudgetInput,
} from './goals_overview.js';

describe('o aporte digitado', () => {
  it.each([
    ['7824', '7824'],
    ['7.824', '7824'],
    ['7.824,50', '7824.50'],
    ['7824,5', '7824.5'],
    ['R$ 10.000', '10000'],
    ['  5000.50 ', '5000.50'],
  ])('lê %s como %s', (typed, expected) => {
    expect(parseBudgetInput(typed)).toBe(expected);
  });

  it.each(['', '   ', '0', '0,00', 'abc', '-100', '1,234,5', '12.3456'])(
    'recusa %j',
    (typed) => {
      expect(parseBudgetInput(typed)).toBeNull();
    },
  );
});

describe('o que a URL guarda', () => {
  it('só aceita orçamento que a api aceitaria', () => {
    expect(decodeBudget('7824.50')).toBe('7824.50');
    expect(decodeBudget('0')).toBeNull();
    expect(decodeBudget('abc')).toBeNull();
    expect(decodeBudget(null)).toBeNull();
  });

  it('a cascata ligada é o padrão', () => {
    expect(decodeCascade(null)).toBe(true);
    expect(decodeCascade('0')).toBe(false);
  });
});

describe('a chegada contra o prazo', () => {
  it('escreve atraso, prazo e antecedência', () => {
    expect(againstDeadline(21)).toEqual({ text: '+21 meses', tone: 'attention' });
    expect(againstDeadline(1)).toEqual({ text: '+1 mês', tone: 'attention' });
    expect(againstDeadline(0)).toEqual({ text: 'no prazo', tone: 'positive' });
    expect(againstDeadline(-8)).toEqual({ text: '8 meses antes', tone: 'positive' });
  });

  it('nulo é meta que não fecha, e não zero', () => {
    expect(againstDeadline(null)).toEqual({
      text: 'não fecha em 100 anos',
      tone: 'negative',
    });
  });
});
