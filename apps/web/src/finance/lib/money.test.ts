import { describe, expect, it } from 'vitest';

import { centsToDecimal, decimalToCents, splitInstallments, sum } from './money.js';

describe('dinheiro em centavos', () => {
  it('converte centavos em decimal textual e de volta', () => {
    expect(centsToDecimal(450000)).toBe('4500.00');
    expect(centsToDecimal(-5590)).toBe('-55.90');
    expect(centsToDecimal(5)).toBe('0.05');
    expect(centsToDecimal(0)).toBe('0.00');
    expect(decimalToCents('4500.00')).toBe(450000);
    expect(decimalToCents('-55.9')).toBe(-5590);
    expect(decimalToCents('12')).toBe(1200);
    expect(decimalToCents('1,5')).toBeNull();
  });

  it('a soma é exata, sem erro de ponto flutuante', () => {
    expect(sum([10, 20])).toBe(30);
    // 0,1 + 0,2 em ponto flutuante dá 0,30000000000000004.
    expect(centsToDecimal(sum([10, 20]))).toBe('0.30');
  });

  it('RN-45: divide em parcelas com o resto na primeira', () => {
    expect(splitInstallments(300000, 6)).toEqual([
      50000, 50000, 50000, 50000, 50000, 50000,
    ]);
    expect(splitInstallments(10000, 3)).toEqual([3334, 3333, 3333]);
    expect(sum(splitInstallments(10001, 7))).toBe(10001);
    expect(splitInstallments(500, 1)).toEqual([500]);
  });
});
