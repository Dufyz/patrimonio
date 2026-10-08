import { describe, expect, it } from 'vitest';

import type { Storageish } from '../preferences.js';
import type { ColumnVisibility } from './columns.js';
import {
  EMPTY_COLUMN_PREFERENCE,
  hiddenByWidth,
  moveColumn,
  orderColumns,
  readColumnPreference,
  toggleColumn,
  visibleColumns,
  writeColumnPreference,
} from './columns.js';

/** As colunas de Posições, na ordem da prancha 05. */
const columns: readonly ColumnVisibility[] = [
  { id: 'ativo', essential: true },
  { id: 'quantidade', hideBelow: 1000 },
  { id: 'preco_medio', hideBelow: 1400 },
  { id: 'preco', hideBelow: 1100 },
  { id: 'valor', essential: true },
  { id: 'peso', hideBelow: 1000 },
  { id: 'resultado', hideBelow: 1100 },
  { id: 'rentabilidade', hideBelow: 1400 },
  { id: 'detalhe', hideBelow: 1400 },
];

const ids = (list: readonly ColumnVisibility[]): string[] =>
  list.map((column) => column.id);

const memoryStorage = (): Storageish => {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
};

describe('colunas da tabela densa', () => {
  it('em tela larga todas as colunas aparecem', () => {
    expect(ids(visibleColumns(columns, 1600))).toEqual(ids(columns));
  });

  it('as colunas secundárias somem em etapas, em ordem definida', () => {
    expect(ids(visibleColumns(columns, 1399))).toEqual([
      'ativo',
      'quantidade',
      'preco',
      'valor',
      'peso',
      'resultado',
    ]);
    expect(ids(visibleColumns(columns, 1099))).toEqual([
      'ativo',
      'quantidade',
      'valor',
      'peso',
    ]);
    expect(ids(visibleColumns(columns, 999))).toEqual(['ativo', 'valor']);
  });

  it('coluna essencial sobrevive a qualquer largura', () => {
    expect(ids(visibleColumns(columns, 320))).toEqual(['ativo', 'valor']);
  });

  it('coluna essencial também ignora a tentativa de escondê-la', () => {
    const preference = toggleColumn(EMPTY_COLUMN_PREFERENCE, 'valor');
    expect(ids(visibleColumns(columns, 1600, preference))).toContain('valor');
  });

  it('a coluna desmarcada some sem mexer nas outras', () => {
    const preference = toggleColumn(EMPTY_COLUMN_PREFERENCE, 'peso');
    expect(ids(visibleColumns(columns, 1600, preference))).not.toContain('peso');
    expect(ids(visibleColumns(columns, 1600, preference))).toContain('resultado');
  });

  it('desmarcar e marcar de novo devolve a coluna', () => {
    const once = toggleColumn(EMPTY_COLUMN_PREFERENCE, 'peso');
    expect(toggleColumn(once, 'peso').hidden).toEqual([]);
  });

  it('a escolha e a ordem persistem por tela', () => {
    const storage = memoryStorage();
    writeColumnPreference(storage, 'posicoes', {
      order: ['valor', 'ativo'],
      hidden: ['peso'],
    });

    expect(readColumnPreference(storage, 'posicoes')).toEqual({
      order: ['valor', 'ativo'],
      hidden: ['peso'],
    });
    // Outra tela tem a sua.
    expect(readColumnPreference(storage, 'movimentacoes')).toEqual(
      EMPTY_COLUMN_PREFERENCE,
    );
  });

  it('preferência corrompida não derruba a tabela', () => {
    const storage = memoryStorage();
    storage.setItem('patrimonio.columns.posicoes', '{"order":42}');
    expect(readColumnPreference(storage, 'posicoes')).toEqual(EMPTY_COLUMN_PREFERENCE);
  });

  it('a ordem escolhida vale sobre a ordem declarada', () => {
    const preference = { order: ['valor', 'ativo', 'peso'], hidden: [] };
    expect(ids(orderColumns(columns, preference)).slice(0, 2)).toEqual([
      'valor',
      'ativo',
    ]);
  });

  it('coluna nova entra junto da vizinha declarada, não no fim', () => {
    const preference = { order: ['ativo', 'valor'], hidden: [] };
    const withNew: readonly ColumnVisibility[] = [
      { id: 'ativo', essential: true },
      { id: 'vencimento' },
      { id: 'valor', essential: true },
    ];
    expect(ids(orderColumns(withNew, preference))).toEqual([
      'ativo',
      'vencimento',
      'valor',
    ]);
  });

  it('mover uma coluna reordena só ela', () => {
    const moved = moveColumn(columns, EMPTY_COLUMN_PREFERENCE, 'valor', 1);
    expect(moved.order.slice(0, 3)).toEqual(['ativo', 'valor', 'quantidade']);
  });

  it('o menu sabe dizer qual coluna a largura está escondendo', () => {
    expect(hiddenByWidth(columns, 1099)).toEqual([
      'preco_medio',
      'preco',
      'resultado',
      'rentabilidade',
      'detalhe',
    ]);
    expect(hiddenByWidth(columns, 1600)).toEqual([]);
  });
});
