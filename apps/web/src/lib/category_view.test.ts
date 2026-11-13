import { describe, expect, it } from 'vitest';

import {
  EMPTY_CATEGORY_FILTERS,
  filterLines,
  linesOf,
  sectionTotal,
  sortLines,
} from './category_view.js';
import type { CategoryItem } from './category_view.js';

const cat = (
  id: string,
  name: string,
  kind: 'receita' | 'despesa',
  nature?: 'fixa' | 'livre',
): CategoryItem => ({
  id,
  name,
  kind,
  color: 'blue',
  nature: nature ?? null,
  archived: false,
});

const usage = new Map([
  ['m', { posted: '300.00', planned: '0.00', entries_total: 3 }],
  ['a', { posted: '1200.00', planned: '50.00', entries_total: 1 }],
]);

describe('Categorias (CAT-01/02)', () => {
  const lines = linesOf(
    [
      cat('m', 'Mercado', 'despesa', 'livre'),
      cat('a', 'Aluguel', 'despesa', 'fixa'),
      cat('z', 'Zerada', 'despesa', 'livre'),
      cat('s', 'Salário', 'receita'),
      { ...cat('x', 'Arquivada', 'despesa'), archived: true },
    ],
    usage,
  );

  it('toda categoria ativa aparece, também as sem uso, zeradas', () => {
    expect(lines.map((l) => l.name)).toEqual(['Mercado', 'Aluguel', 'Zerada', 'Salário']);
    expect(lines.find((l) => l.id === 'z')?.posted).toBe('0.00');
  });

  it('o total da seção soma lançado e previsto sem misturar', () => {
    const despesas = lines.filter((l) => l.kind === 'despesa');
    expect(sectionTotal(despesas, 'posted')).toBe('1500.00');
    expect(sectionTotal(despesas, 'planned')).toBe('50.00');
  });

  it('ordena por nome (padrão) ou por lançado e previsto, do maior ao menor', () => {
    const despesas = lines.filter((l) => l.kind === 'despesa');
    expect(sortLines(despesas, 'nome').map((l) => l.name)).toEqual([
      'Aluguel',
      'Mercado',
      'Zerada',
    ]);
    expect(sortLines(despesas, 'lancado').map((l) => l.name)).toEqual([
      'Aluguel',
      'Mercado',
      'Zerada',
    ]);
    expect(sortLines(despesas, 'previsto')[0]?.name).toBe('Aluguel');
  });

  it('filtra por busca, tipo e natureza', () => {
    expect(
      filterLines(lines, { ...EMPTY_CATEGORY_FILTERS, q: 'merc' }).map((l) => l.id),
    ).toEqual(['m']);
    expect(
      filterLines(lines, { ...EMPTY_CATEGORY_FILTERS, kind: 'receita' }).map((l) => l.id),
    ).toEqual(['s']);
    expect(
      filterLines(lines, { ...EMPTY_CATEGORY_FILTERS, nature: 'fixa' }).map((l) => l.id),
    ).toEqual(['a']);
  });
});
