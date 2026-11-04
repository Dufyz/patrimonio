import { describe, expect, it } from 'vitest';

import {
  buildImportRows,
  guessMapping,
  missingFields,
  parseCsv,
  parseImportDate,
  parseImportKind,
  parseImportTicker,
} from './import_csv.js';

describe('parseCsv', () => {
  it('detecta ; e respeita aspas e BOM', () => {
    expect(parseCsv('﻿Data;Ativo\n"01/02/2024";"A;B"\n')).toEqual([
      ['Data', 'Ativo'],
      ['01/02/2024', 'A;B'],
    ]);
  });

  it('aceita vírgula e ignora linhas vazias', () => {
    expect(parseCsv('a,b\r\n\r\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
});

describe('mapeamento e linhas', () => {
  const table = parseCsv(
    [
      'Data;Tipo;Código;Qtd;Preço;Taxas',
      '05/03/2024;Compra;ITUB4F;100;32,41;1,50',
      '31/02/2024;Venda;VALE3;10;60,00;',
      '10/03/2024;Troca;??;0;x;',
    ].join('\n'),
  );

  it('reconhece as colunas pelo cabeçalho', () => {
    const mapping = guessMapping(table[0] ?? []);
    expect(mapping).toEqual({
      date: 0,
      kind: 1,
      ticker: 2,
      quantity: 3,
      price: 4,
      fees: 5,
    });
    expect(missingFields(mapping)).toEqual([]);
  });

  it('valida cada linha e aponta o que está errado', () => {
    const rows = buildImportRows(table, guessMapping(table[0] ?? []));

    expect(rows[0]).toMatchObject({
      line: 2,
      trade_date: '2024-03-05',
      kind: 'buy',
      ticker: 'ITUB4',
      quantity: '100',
      unit_price: '32.41',
      fees: '1.50',
      errors: [],
    });
    expect(rows[1]?.errors).toEqual(['data inválida']);
    expect(rows[2]?.errors).toEqual([
      'tipo desconhecido',
      'ativo inválido',
      'quantidade inválida',
      'preço inválido',
    ]);
  });

  it('campo obrigatório sem coluna é apontado', () => {
    expect(missingFields(guessMapping(['Foo', 'Bar']))).toHaveLength(5);
  });
});

describe('células', () => {
  it('datas, tipos e códigos', () => {
    expect(parseImportDate('2024-03-05')).toBe('2024-03-05');
    expect(parseImportDate('5/3/2024')).toBe('2024-03-05');
    expect(parseImportDate('30/02/2024')).toBeNull();
    expect(parseImportKind(' C ')).toBe('buy');
    expect(parseImportKind('Venda')).toBe('sell');
    expect(parseImportTicker('petr4f')).toBe('PETR4');
  });
});
