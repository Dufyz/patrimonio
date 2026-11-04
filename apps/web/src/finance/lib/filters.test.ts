import { describe, expect, it } from 'vitest';

import {
  appliedChips,
  clearFilterField,
  countActiveFilters,
  passesFilters,
  toggleFilterValue,
} from './filters.js';
import type { FilterField } from './filters.js';
import { matchesSearch, normalizeText } from './text.js';
import {
  isColumnVisible,
  readHiddenColumns,
  toggleColumn,
  writeHiddenColumns,
} from './columns.js';

const fields: readonly FilterField[] = [
  {
    id: 'tipo',
    label: 'Tipo',
    options: [
      { value: 'expense', label: 'Despesa' },
      { value: 'income', label: 'Receita' },
    ],
  },
  { id: 'conta', label: 'Conta', options: [{ value: 'itau', label: 'Itaú Corrente' }] },
];

describe('filtros de múltipla escolha', () => {
  it('marca e desmarca valores, e campo sem valores deixa de filtrar', () => {
    let state = toggleFilterValue({}, 'tipo', 'expense');
    state = toggleFilterValue(state, 'tipo', 'income');
    expect(state).toEqual({ tipo: ['expense', 'income'] });
    expect(countActiveFilters(state)).toBe(2);

    state = toggleFilterValue(state, 'tipo', 'expense');
    state = toggleFilterValue(state, 'tipo', 'income');
    expect(state).toEqual({});
  });

  it('o registro passa quando casa com algum valor de cada campo ativo', () => {
    const state = { tipo: ['expense'], conta: ['itau', 'nubank'] };
    expect(passesFilters(state, (f) => (f === 'tipo' ? 'expense' : 'itau'))).toBe(true);
    expect(passesFilters(state, (f) => (f === 'tipo' ? 'income' : 'itau'))).toBe(false);
    expect(
      passesFilters(state, (f) => (f === 'tipo' ? 'expense' : ['flex', 'itau'])),
    ).toBe(true);
    expect(passesFilters({}, () => 'qualquer')).toBe(true);
  });

  it('gera etiquetas removíveis uma a uma', () => {
    const state = { tipo: ['expense'], conta: ['itau'] };
    expect(appliedChips(fields, state).map((chip) => chip.label)).toEqual([
      'Tipo: Despesa',
      'Conta: Itaú Corrente',
    ]);
    expect(clearFilterField(state, 'tipo')).toEqual({ conta: ['itau'] });
  });
});

describe('busca', () => {
  it('ignora acento e caixa, e exige todas as palavras', () => {
    expect(normalizeText('Saúde')).toBe('saude');
    expect(
      matchesSearch('saude plano', ['Plano de saúde', 'Saúde', 'Itaú Corrente']),
    ).toBe(true);
    expect(matchesSearch('luz itau', ['Conta de luz', 'Moradia', 'Itaú Corrente'])).toBe(
      true,
    );
    expect(matchesSearch('netflix', ['Conta de luz'])).toBe(false);
    expect(matchesSearch('  ', ['qualquer'])).toBe(true);
  });
});

describe('exibição de colunas', () => {
  const columns = [
    { id: 'descricao', label: 'Descrição', locked: true },
    { id: 'conta', label: 'Conta' },
  ];

  it('persiste por tela e descarta o que não existe ou é fixo', () => {
    const storage = {
      store: new Map<string, string>(),
      getItem(key: string) {
        return this.store.get(key) ?? null;
      },
      setItem(key: string, value: string) {
        this.store.set(key, value);
      },
      removeItem(key: string) {
        this.store.delete(key);
      },
    };
    writeHiddenColumns(storage, 'lancamentos', ['conta', 'descricao', 'fantasma']);
    expect(readHiddenColumns(storage, 'lancamentos', columns)).toEqual(['conta']);
    expect(readHiddenColumns(storage, 'categorias', columns)).toEqual([]);
  });

  it('a coluna fixa nunca some', () => {
    expect(toggleColumn([], columns, 'descricao')).toEqual([]);
    expect(toggleColumn([], columns, 'conta')).toEqual(['conta']);
    expect(isColumnVisible(['conta'], 'conta')).toBe(false);
  });
});
