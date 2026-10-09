import { describe, expect, it } from 'vitest';

import { indexCodesOf, parseBenchmarkDefinition } from './definition.js';

describe('a definição do benchmark como o banco guarda', () => {
  it('índice simples', () => {
    expect(parseBenchmarkDefinition('index', { index: 'CDI' })).toEqual({
      kind: 'index',
      index: 'CDI',
    });
  });

  it('o cupom vem em fração anual e o motor recebe em percentual', () => {
    expect(
      parseBenchmarkDefinition('index_plus_rate', { index: 'IPCA', rate: 0.06 }),
    ).toEqual({ kind: 'index_plus_rate', index: 'IPCA', rate: '6' });

    expect(
      parseBenchmarkDefinition('index_plus_rate', { index: 'IPCA', rate: '0.055' }),
    ).toEqual({ kind: 'index_plus_rate', index: 'IPCA', rate: '5.5' });
  });

  it('composto mantém os pesos como declarados: a normalização é do motor', () => {
    expect(
      parseBenchmarkDefinition('blend', {
        parts: [
          { index: 'CDI', weight: 0.5 },
          { index: 'IBOV', weight: '0.5' },
        ],
      }),
    ).toEqual({
      kind: 'blend',
      parts: [
        { index: 'CDI', weight: '0.5' },
        { index: 'IBOV', weight: '0.5' },
      ],
    });
  });

  it.each([
    ['index', null],
    ['index', []],
    ['index', { index: '' }],
    ['index', { index: 7 }],
    ['index_plus_rate', { index: 'IPCA' }],
    ['index_plus_rate', { index: 'IPCA', rate: 'seis' }],
    ['index_plus_rate', { rate: 0.06 }],
    ['blend', { parts: [] }],
    ['blend', { parts: 'CDI' }],
    ['blend', { parts: [null] }],
    ['blend', { parts: [{ index: 'CDI' }] }],
    ['blend', { parts: [{ index: 'CDI', weight: -1 }] }],
    ['desconhecido', { index: 'CDI' }],
  ])('definição sem sentido (%s %j) não vira benchmark parado', (kind, definition) => {
    expect(parseBenchmarkDefinition(kind, definition)).toBeNull();
  });
});

describe('os índices de que o benchmark depende', () => {
  it('um índice só para o simples e para o índice mais cupom', () => {
    expect(indexCodesOf({ kind: 'index', index: 'CDI' })).toEqual(['CDI']);
    expect(indexCodesOf({ kind: 'index_plus_rate', index: 'IPCA', rate: '6' })).toEqual([
      'IPCA',
    ]);
  });

  it('o composto lista cada índice uma vez', () => {
    expect(
      indexCodesOf({
        kind: 'blend',
        parts: [
          { index: 'CDI', weight: '1' },
          { index: 'IBOV', weight: '1' },
          { index: 'CDI', weight: '1' },
        ],
      }),
    ).toEqual(['CDI', 'IBOV']);
  });
});
