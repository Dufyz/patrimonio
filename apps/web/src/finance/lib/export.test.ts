import { describe, expect, it } from 'vitest';

import { toCsv } from './csv.js';
import { csvAmount, exportFilename, tableRows } from './export.js';

describe('valores do CSV', () => {
  it('número com ponto decimal, sem moeda e sem milhar', () => {
    expect(csvAmount(450000)).toBe('4500.00');
    expect(csvAmount(-31240)).toBe('-312.40');
    expect(csvAmount(5)).toBe('0.05');
    expect(csvAmount(0)).toBe('0.00');
  });
});

describe('tabela exportada', () => {
  const columns = [
    { id: 'a', header: 'A', value: (r: { a: string; b: string }) => r.a },
    { id: 'b', header: 'B', value: (r: { a: string; b: string }) => r.b },
  ];
  const rows = [
    { a: '1', b: 'x' },
    { a: '2', b: 'y' },
  ];

  it('só as colunas visíveis, na ordem, e as linhas dadas', () => {
    expect(tableRows(columns, [], rows)).toEqual([
      ['A', 'B'],
      ['1', 'x'],
      ['2', 'y'],
    ]);
    expect(tableRows(columns, ['a'], rows)).toEqual([['B'], ['x'], ['y']]);
  });

  it('o nome do arquivo traz a tela e o período', () => {
    expect(exportFilename('lancamentos', { from: '2026-10-01', to: '2026-10-31' })).toBe(
      'lancamentos_2026-10-01_2026-10-31.csv',
    );
  });

  it('vírgula, aspas e quebra de linha vão entre aspas', () => {
    expect(toCsv([['a,b', 'c"d', 'e\nf', 'g']])).toBe('"a,b","c""d","e\nf",g');
  });
});
