import { FormatChangedError } from '@patrimonio/application';
import { describe, expect, it } from 'vitest';

import { readCotahistInstruments } from './instruments.js';
import { RECORD_LENGTH, parseInstrumentRecord } from './layout.js';

const record = (input: {
  readonly date?: string;
  readonly ticker?: string;
  readonly codbdi?: string;
  readonly name?: string;
  readonly species?: string;
  readonly tpmerc?: string;
}): string =>
  [
    '01',
    (input.date ?? '20261009').padEnd(8, '0'),
    (input.codbdi ?? '02').padStart(2, '0'),
    (input.ticker ?? 'ITUB4').padEnd(12, ' '),
    input.tpmerc ?? '010',
    (input.name ?? 'ITAUUNIBANCO').padEnd(12, ' '),
    (input.species ?? 'PN      N1').padEnd(10, ' '),
    ''.padEnd(3, ' '),
    'R$ '.padEnd(4, ' '),
    '0000000003100',
    '0000000003290',
    '0000000003050',
    '0000000003180',
    '0000000003241',
  ]
    .join('')
    .padEnd(RECORD_LENGTH, ' ');

describe('o papel de uma linha do COTAHIST', () => {
  it('ação leva a espécie no nome: é ela que distingue ITUB3 de ITUB4', () => {
    expect(parseInstrumentRecord(record({}), 1)).toEqual({
      ticker: 'ITUB4',
      name: 'ITAUUNIBANCO PN',
      b3_type: 'stock',
      trade_date: '2026-10-09',
    });
  });

  it('FII, ETF e BDR saem com o nome resumido', () => {
    const fii = parseInstrumentRecord(
      record({ ticker: 'KNRI11', codbdi: '12', name: 'FII KINEA RE', species: 'CI' }),
      1,
    );
    const etf = parseInstrumentRecord(
      record({ ticker: 'BOVA11', name: 'ISHARES BOVA', species: 'CI' }),
      1,
    );
    const bdr = parseInstrumentRecord(
      record({ ticker: 'AAPL34', name: 'APPLE', species: 'DRN' }),
      1,
    );

    expect([fii?.b3_type, fii?.name]).toEqual(['fii', 'FII KINEA RE']);
    expect([etf?.b3_type, etf?.name]).toEqual(['etf', 'ISHARES BOVA']);
    expect([bdr?.b3_type, bdr?.name]).toEqual(['bdr', 'APPLE']);
  });

  it('fracionário, termo e opção ficam fora', () => {
    expect(
      parseInstrumentRecord(record({ ticker: 'ITUB4F', codbdi: '96' }), 1),
    ).toBeNull();
    expect(parseInstrumentRecord(record({ tpmerc: '030' }), 1)).toBeNull();
    expect(parseInstrumentRecord(record({ tpmerc: '070' }), 1)).toBeNull();
  });
});

describe('os papéis de um arquivo', () => {
  it('um por ticker, com o último pregão e o nome da última linha', async () => {
    const result = await readCotahistInstruments([
      '00COTAHIST.2026BOVESPA 2026123120270104'.padEnd(RECORD_LENGTH, ' '),
      record({ date: '20260105', ticker: 'ITUB4', name: 'ITAUUNIBANCO' }),
      record({ date: '20261009', ticker: 'ITUB4', name: 'ITAU UNIBANC' }),
      record({ date: '20260106', ticker: 'ITUB4F', codbdi: '96' }),
      record({ date: '20260201', ticker: 'PETR4', name: 'PETROBRAS' }),
      '99COTAHIST.2026BOVESPA'.padEnd(RECORD_LENGTH, ' '),
    ]);

    expect(result.isSuccess()).toBe(true);
    if (!result.isSuccess()) return;

    expect(result.value.instruments.map((item) => item.ticker)).toEqual([
      'ITUB4',
      'PETR4',
    ]);
    expect(result.value.instruments[0]).toMatchObject({
      name: 'ITAU UNIBANC PN',
      last_trade_date: '2026-10-09',
    });
    expect(result.value.first_date).toBe('2026-01-05');
    expect(result.value.last_date).toBe('2026-10-09');
    expect(result.value.lines_read).toBe(6);
  });

  it('linha curta é mudança de formato e falha alto', async () => {
    const result = await readCotahistInstruments(['01202610090211ITUB4']);

    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) expect(result.value).toBeInstanceOf(FormatChangedError);
  });
});
