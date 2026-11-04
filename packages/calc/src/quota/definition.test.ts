import { describe, expect, it } from 'vitest';

import { indexCodesOf } from './definition.js';

describe('os índices de que o benchmark depende', () => {
  it('um índice só, em qualquer das três formas', () => {
    expect(indexCodesOf({ kind: 'index', index: 'CDI' })).toEqual(['CDI']);
    expect(indexCodesOf({ kind: 'index_plus_rate', index: 'IPCA', rate: '6' })).toEqual([
      'IPCA',
    ]);
    expect(
      indexCodesOf({ kind: 'percent_of_index', index: 'CDI', percent: '110' }),
    ).toEqual(['CDI']);
  });
});
