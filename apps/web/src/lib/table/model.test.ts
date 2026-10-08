import { describe, expect, it } from 'vitest';

import type { TableGroup, TableState } from './model.js';
import { EMPTY_TABLE_STATE, buildRowModel, nextSort, toggle } from './model.js';

type Position = {
  readonly id: string;
  readonly ticker: string;
  readonly value: string;
  readonly result: string | null;
};

/** Sem resultado informado, a posição não tem resultado — e não tem zero. */
const position = (
  ticker: string,
  value: string,
  result: string | null = null,
): Position => ({ id: ticker, ticker, value, result });

/** Catorze ações, como a prancha 05, para o "mostrar mais" ter o que esconder. */
const acoes: TableGroup<Position> = {
  key: 'acoes',
  label: 'Ações',
  colorToken: 'class.acoes',
  rows: [
    position('ITUB4', '18420.00', '3870.00'),
    position('WEGE3', '15230.00', '-3170.00'),
    position('EGIE3', '12375.00', '675.00'),
    position('VALE3', '11680.00', '-1140.00'),
    position('PETR4', '10818.80', '1162.80'),
    position('BBAS3', '9000.00'),
    position('TAEE11', '8000.00'),
    position('CPLE6', '7000.00'),
    position('SAPR11', '6000.00'),
    position('KLBN11', '5000.00'),
    position('ABEV3', '4000.00'),
    position('RADL3', '3000.00'),
    position('MGLU3', '2000.00'),
    position('XYZW3', '1116.55'),
  ],
  summary: { value: '112640.35', result: '9820.15' },
};

const fiis: TableGroup<Position> = {
  key: 'fiis',
  label: 'FIIs',
  colorToken: 'class.fiis',
  rows: [position('HGLG11', '17890.40'), position('KNRI11', '16684.50')],
  summary: { value: '76820.50', result: '2910.40' },
};

const build = (state: Partial<TableState> = {}, rowsPerGroup?: number) =>
  buildRowModel<Position>({
    groups: [acoes, fiis],
    state: { ...EMPTY_TABLE_STATE, ...state },
    rowId: (row) => row.id,
    sortValue: (row, columnId) =>
      columnId === 'ticker' ? row.ticker : columnId === 'result' ? row.result : row.value,
    isNumericColumn: (columnId) => columnId !== 'ticker',
    total: { value: '487320.55', result: '25673.59' },
    ...(rowsPerGroup === undefined ? {} : { rowsPerGroup }),
  });

const kinds = (model: readonly { kind: string }[]): string[] =>
  model.map((entry) => entry.kind);

describe('modelo da tabela densa', () => {
  it('o subtotal do grupo não muda quando "mostrar mais" esconde linhas', () => {
    const limited = build();
    const expanded = build({ expandedGroups: ['acoes'] });

    const subtotal = (model: ReturnType<typeof build>) =>
      model.find((entry) => entry.kind === 'group' && entry.group.key === 'acoes');

    const limitedGroup = subtotal(limited);
    const expandedGroup = subtotal(expanded);

    expect(limitedGroup?.kind).toBe('group');
    if (limitedGroup?.kind !== 'group' || expandedGroup?.kind !== 'group') return;

    expect(limitedGroup.group.summary['value']).toBe('112640.35');
    expect(expandedGroup.group.summary['value']).toBe(
      limitedGroup.group.summary['value'],
    );
    // O subtotal cobre as catorze, não as cinco visíveis.
    expect(limitedGroup.count).toBe(14);
  });

  it('"mostrar mais" anuncia quantas linhas faltam, com o nome do grupo', () => {
    const more = build().find((entry) => entry.kind === 'more');
    expect(more?.kind).toBe('more');
    if (more?.kind !== 'more') return;
    expect(more.hiddenCount).toBe(9);
    expect(more.groupLabel).toBe('Ações');
  });

  it('grupo com poucas linhas não ganha "mostrar mais"', () => {
    const model = build();
    const moreForFiis = model.filter(
      (entry) => entry.kind === 'more' && entry.groupKey === 'fiis',
    );
    expect(moreForFiis).toHaveLength(0);
  });

  it('ordenar por valor não embaralha a ordem dos grupos', () => {
    const model = build({ sort: { columnId: 'value', direction: 'desc' } });
    const groupOrder = model
      .filter((entry) => entry.kind === 'group')
      .map((entry) => (entry.kind === 'group' ? entry.group.key : ''));

    // Ações soma mais que FIIs, então continua em cima — e as linhas de cada
    // grupo ficam dentro do seu grupo.
    expect(groupOrder).toEqual(['acoes', 'fiis']);
    expect(kinds(model).indexOf('group')).toBe(0);
  });

  it('ordenar por valor crescente inverte grupos e linhas juntos', () => {
    const model = build({ sort: { columnId: 'value', direction: 'asc' } });
    const groupOrder = model
      .filter((entry) => entry.kind === 'group')
      .map((entry) => (entry.kind === 'group' ? entry.group.key : ''));
    const firstRow = model.find((entry) => entry.kind === 'row');

    expect(groupOrder).toEqual(['fiis', 'acoes']);
    expect(firstRow?.kind === 'row' ? firstRow.row.ticker : '').toBe('KNRI11');
  });

  it('ordena valor por grandeza, não por texto', () => {
    const model = build({
      sort: { columnId: 'value', direction: 'desc' },
      expandedGroups: ['acoes'],
    });
    const tickers = model
      .filter((entry) => entry.kind === 'row')
      .map((entry) => (entry.kind === 'row' ? entry.row.ticker : ''));

    // `9000.00` é maior que `18420.00` em ordem de texto, e menor em grandeza.
    expect(tickers.slice(0, 3)).toEqual(['ITUB4', 'WEGE3', 'EGIE3']);
  });

  it('linha sem valor vai para o fim nos dois sentidos', () => {
    const forward = build({
      sort: { columnId: 'result', direction: 'desc' },
      expandedGroups: ['acoes'],
    });
    const backward = build({
      sort: { columnId: 'result', direction: 'asc' },
      expandedGroups: ['acoes'],
    });

    const last = (model: ReturnType<typeof build>) => {
      const rows = model.filter((entry) => entry.kind === 'row');
      const tail = rows.at(-1);
      return tail?.kind === 'row' ? tail.row.result : 'não é linha';
    };

    expect(last(forward)).toBeNull();
    expect(last(backward)).toBeNull();
  });

  it('grupo fechado esconde as linhas e mantém o subtotal', () => {
    const model = build({ collapsedGroups: ['acoes'] });
    const tickers = model
      .filter((entry) => entry.kind === 'row')
      .map((entry) => (entry.kind === 'row' ? entry.row.ticker : ''));

    expect(tickers).toEqual(['HGLG11', 'KNRI11']);
    expect(
      model.some((entry) => entry.kind === 'group' && entry.group.key === 'acoes'),
    ).toBe(true);
  });

  it('o total geral fecha a tabela, depois de todos os grupos', () => {
    const model = build();
    expect(model.at(-1)?.kind).toBe('total');
  });

  it('a ordenação tem três passos e volta à ordem da api', () => {
    expect(nextSort(null, 'value')).toEqual({ columnId: 'value', direction: 'desc' });
    expect(nextSort({ columnId: 'value', direction: 'desc' }, 'value')).toEqual({
      columnId: 'value',
      direction: 'asc',
    });
    expect(nextSort({ columnId: 'value', direction: 'asc' }, 'value')).toBeNull();
    expect(nextSort({ columnId: 'value', direction: 'asc' }, 'ticker')).toEqual({
      columnId: 'ticker',
      direction: 'desc',
    });
  });

  it('alternar grupo é reversível', () => {
    expect(toggle(toggle([], 'acoes'), 'acoes')).toEqual([]);
    expect(toggle(['fiis'], 'acoes')).toEqual(['fiis', 'acoes']);
  });

  it('um limite menor esconde mais linhas sem tocar no subtotal', () => {
    const model = build({}, 2);
    const more = model.find((entry) => entry.kind === 'more');
    expect(more?.kind === 'more' ? more.hiddenCount : 0).toBe(12);
  });
});
