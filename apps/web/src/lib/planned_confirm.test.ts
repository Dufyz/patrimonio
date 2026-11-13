import { describe, expect, it } from 'vitest';

import { centsToDecimal, parseAmountInput, suggestedDate } from './planned_confirm.js';

describe('planned_confirm', () => {
  it('centavos para decimal sem float', () => {
    expect(centsToDecimal('150000')).toBe('1500.00');
    expect(centsToDecimal('5')).toBe('0.05');
  });
  it('aceita formatos pt-BR e da API; recusa zero e lixo', () => {
    expect(parseAmountInput('1.500,25')).toBe('1500.25');
    expect(parseAmountInput('1500,5')).toBe('1500.50');
    expect(parseAmountInput('1500.25')).toBe('1500.25');
    expect(parseAmountInput('0')).toBeNull();
    expect(parseAmountInput('abc')).toBeNull();
  });
  it('data sugerida: a do previsto, ou hoje se futura', () => {
    expect(suggestedDate('2026-11-05', '2026-11-13')).toBe('2026-11-05');
    expect(suggestedDate('2026-11-20', '2026-11-13')).toBe('2026-11-13');
  });
});
