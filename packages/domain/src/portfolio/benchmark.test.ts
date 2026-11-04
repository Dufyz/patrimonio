import { describe, expect, it } from 'vitest';

import {
  benchmarkLabel,
  formatBenchmark,
  normalizeBenchmark,
  parseBenchmark,
} from './benchmark.js';

describe('parseBenchmark', () => {
  it('índice sozinho, sem diferença de caixa', () => {
    expect(parseBenchmark('cdi')).toEqual({ kind: 'index', index: 'CDI' });
    expect(parseBenchmark(' Ibov ')).toEqual({ kind: 'index', index: 'IBOV' });
  });

  it('índice mais taxa, em qualquer escrita', () => {
    const esperado = { kind: 'index_plus_rate', index: 'IPCA', rate: '6' };

    expect(parseBenchmark('IPCA+6')).toEqual(esperado);
    expect(parseBenchmark('ipca + 6%')).toEqual(esperado);
    expect(parseBenchmark('IPCA+6.00')).toEqual(esperado);
    expect(parseBenchmark('IPCA+6,5')).toEqual({ ...esperado, rate: '6.5' });
  });

  it('percentual do índice, em qualquer escrita', () => {
    const esperado = { kind: 'percent_of_index', index: 'CDI', percent: '110' };

    expect(parseBenchmark('110%CDI')).toEqual(esperado);
    expect(parseBenchmark('110% do CDI')).toEqual(esperado);
    expect(parseBenchmark('110 % CDI')).toEqual(esperado);
  });

  it.each(['', 'XYZ', 'IPCA+', 'IPCA+0', '0%CDI', '110%', 'IPCA-6', '110CDI', 'CDI+IBOV'])(
    '%j não é benchmark',
    (text) => {
      expect(parseBenchmark(text)).toBeNull();
    },
  );
});

describe('formatBenchmark e benchmarkLabel', () => {
  it('o texto canônico é estável', () => {
    expect(normalizeBenchmark('IPCA + 6,50%')).toBe('IPCA+6.5');
    expect(normalizeBenchmark('110% do cdi')).toBe('110%CDI');
    expect(normalizeBenchmark('selic')).toBe('SELIC');
    expect(normalizeBenchmark('lixo')).toBeNull();
  });

  it('o nome na tela', () => {
    const label = (text: string): string | null => {
      const value = parseBenchmark(text);
      return value === null ? null : benchmarkLabel(value);
    };

    expect(label('CDI')).toBe('CDI');
    expect(label('ibov')).toBe('Ibovespa');
    expect(label('IPCA+6')).toBe('IPCA + 6%');
    expect(label('110%CDI')).toBe('110% do CDI');
    expect(formatBenchmark({ kind: 'index', index: 'IFIX' })).toBe('IFIX');
  });
});
