import { describe, expect, it } from 'vitest';

import { timeWeightedReturn, xirr } from './asset_returns.js';

const day = (date: string, value: string, flow = '0', income = '0') => ({
  date,
  value,
  flow,
  income,
});

describe('TWR do ativo', () => {
  it('compra, alta e venda total', () => {
    expect(
      timeWeightedReturn([
        day('2026-01-02', '100', '100'),
        day('2026-01-03', '120'),
        day('2026-01-04', '0', '-120'),
      ]),
    ).toBe('20.00');
  });

  it('o aporte não é rendimento', () => {
    // 100 → 110 (+10%); aporta 110 → 220; 220 → 242 (+10%) = 21%
    expect(
      timeWeightedReturn([
        day('2026-01-02', '100', '100'),
        day('2026-01-03', '110'),
        day('2026-01-04', '220', '110'),
        day('2026-01-05', '242'),
      ]),
    ).toBe('21.00');
  });

  it('provento conta como retorno', () => {
    expect(
      timeWeightedReturn([
        day('2026-01-02', '100', '100'),
        day('2026-01-03', '100', '0', '1'),
      ]),
    ).toBe('1.00');
  });

  it('sem dia medível é nulo', () => {
    expect(timeWeightedReturn([day('2026-01-02', '100', '100')])).toBeNull();
  });
});

describe('TIR do ativo', () => {
  it('100 viram 110 em um ano', () => {
    expect(
      xirr([
        { date: '2025-01-01', amount: '-100' },
        { date: '2026-01-01', amount: '110' },
      ]),
    ).toBe('10.00');
  });

  it('prazo curto é nulo', () => {
    expect(
      xirr([
        { date: '2026-01-01', amount: '-100' },
        { date: '2026-01-10', amount: '110' },
      ]),
    ).toBeNull();
  });

  it('sem troca de sinal é nulo', () => {
    expect(
      xirr([
        { date: '2025-01-01', amount: '-100' },
        { date: '2026-01-01', amount: '-10' },
      ]),
    ).toBeNull();
  });
});
