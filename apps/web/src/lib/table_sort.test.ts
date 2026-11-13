import { describe, expect, it } from 'vitest';

import { ariaSort, nextSort, sortRows } from './table_sort.js';

describe('ordenar pelo cabeçalho (CMP-03)', () => {
  it('três cliques: crescente, decrescente e de volta à ordem da tela', () => {
    const first = nextSort(null, 'saldo');
    const second = nextSort(first, 'saldo');
    const third = nextSort(second, 'saldo');

    expect(first).toEqual({ key: 'saldo', dir: 'asc' });
    expect(second).toEqual({ key: 'saldo', dir: 'desc' });
    expect(third).toBeNull();
  });

  it('trocar de coluna recomeça pelo crescente', () => {
    expect(nextSort({ key: 'saldo', dir: 'desc' }, 'nome')).toEqual({
      key: 'nome',
      dir: 'asc',
    });
  });

  it('aria-sort diz o sentido só na coluna ordenada', () => {
    const state = { key: 'saldo', dir: 'desc' } as const;
    expect(ariaSort(state, 'saldo')).toBe('descending');
    expect(ariaSort(state, 'nome')).toBe('none');
    expect(ariaSort(null, 'saldo')).toBe('none');
    expect(ariaSort({ key: 'saldo', dir: 'asc' }, 'saldo')).toBe('ascending');
  });

  const rows = [
    { nome: 'Nubank', saldo: 1022_86n },
    { nome: 'Itaú', saldo: 439_65n },
    { nome: 'Flash', saldo: null },
    { nome: 'Carteira', saldo: 240_00n },
  ];
  const accessors = {
    nome: (row: (typeof rows)[number]) => row.nome,
    saldo: (row: (typeof rows)[number]) => row.saldo,
  };
  const names = (list: readonly (typeof rows)[number][]) => list.map((row) => row.nome);

  it('ordena números pelo valor e textos pela língua, sem mexer na lista original', () => {
    expect(names(sortRows(rows, { key: 'saldo', dir: 'asc' }, accessors))).toEqual([
      'Carteira',
      'Itaú',
      'Nubank',
      'Flash',
    ]);
    expect(names(sortRows(rows, { key: 'nome', dir: 'asc' }, accessors))).toEqual([
      'Carteira',
      'Flash',
      'Itaú',
      'Nubank',
    ]);
    expect(names(rows)).toEqual(['Nubank', 'Itaú', 'Flash', 'Carteira']);
  });

  it('valor ausente fica no fim em qualquer sentido', () => {
    expect(names(sortRows(rows, { key: 'saldo', dir: 'desc' }, accessors))).toEqual([
      'Nubank',
      'Itaú',
      'Carteira',
      'Flash',
    ]);
  });

  it('sem ordenação a lista é a da tela, a mesma instância', () => {
    expect(sortRows(rows, null, accessors)).toBe(rows);
  });

  it('empate mantém a ordem da tela', () => {
    const tied = [
      { nome: 'B', saldo: 1n },
      { nome: 'A', saldo: 1n },
    ];
    expect(
      sortRows(tied, { key: 'saldo', dir: 'desc' }, { saldo: (row) => row.saldo }).map(
        (row) => row.nome,
      ),
    ).toEqual(['B', 'A']);
  });
});
