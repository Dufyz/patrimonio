import { describe, expect, it } from 'vitest';

import { duplicatedCategories, overlappingGroups, sumTargets } from './targets.js';

describe('alvo de alocação', () => {
  it('alvo somando 100 fecha', () => {
    const sum = sumTargets([
      { category_id: 'acoes', target_pct: '35' },
      { category_id: 'fiis', target_pct: '25' },
      { category_id: 'rf', target_pct: '40' },
    ]);

    expect(sum.total_pct).toBe('100.00');
    expect(sum.missing_pp).toBe('0.00');
    expect(sum.closes).toBe(true);
  });

  it('alvo somando 96 não fecha e diz quanto falta', () => {
    const sum = sumTargets([
      { category_id: 'acoes', target_pct: '35' },
      { category_id: 'fiis', target_pct: '25' },
      { category_id: 'rf', target_pct: '36' },
    ]);

    expect(sum.total_pct).toBe('96.00');
    expect(sum.missing_pp).toBe('4.00');
    expect(sum.closes).toBe(false);
  });

  it('lista vazia é "sem estratégia definida", não erro', () => {
    expect(sumTargets([]).closes).toBe(true);
  });

  it('casas decimais somam sem derivar para ponto flutuante', () => {
    const sum = sumTargets([
      { category_id: 'a', target_pct: '33.33' },
      { category_id: 'b', target_pct: '33.33' },
      { category_id: 'c', target_pct: '33.34' },
    ]);

    expect(sum.total_pct).toBe('100.00');
    expect(sum.closes).toBe(true);
  });

  it('duas linhas para a mesma categoria são apontadas', () => {
    expect(
      duplicatedCategories([
        { category_id: 'acoes', target_pct: '50' },
        { category_id: 'acoes', target_pct: '50' },
      ]),
    ).toEqual(['acoes']);
  });
});

describe('grupo e categoria no mesmo alvo', () => {
  const categories = [
    { id: 'acoes', parent_id: 'rv' },
    { id: 'etf-acoes', parent_id: 'rv' },
    { id: 'rv', parent_id: null },
    { id: 'caixa', parent_id: null },
  ];

  it('o grupo com alvo e uma categoria dele com alvo se sobrepõem', () => {
    expect(
      overlappingGroups(
        [
          { category_id: 'rv', target_pct: '60' },
          { category_id: 'acoes', target_pct: '20' },
          { category_id: 'caixa', target_pct: '20' },
        ],
        categories,
      ),
    ).toEqual(['rv']);
  });

  it('o grupo sozinho, ou só as categorias, não se sobrepõem', () => {
    expect(
      overlappingGroups(
        [
          { category_id: 'rv', target_pct: '80' },
          { category_id: 'caixa', target_pct: '20' },
        ],
        categories,
      ),
    ).toEqual([]);
    expect(
      overlappingGroups(
        [
          { category_id: 'acoes', target_pct: '40' },
          { category_id: 'etf-acoes', target_pct: '40' },
          { category_id: 'caixa', target_pct: '20' },
        ],
        categories,
      ),
    ).toEqual([]);
  });
});
