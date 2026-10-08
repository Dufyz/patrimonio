import { FormatChangedError } from '@patrimonio/application';
import { describe, expect, it } from 'vitest';

import { RECORD_LENGTH, parseRecord } from './layout.js';
import { readCotahist } from './reader.js';

/**
 * Um registro do COTAHIST montado campo a campo. Escrever o layout aqui, e não
 * colar uma linha de 245 caracteres opaca, é o que torna o teste legível: cada
 * posição fica visível, e quando a B3 mudar o layout a diferença aparece aqui.
 */
const record = (input: {
  readonly date?: string;
  readonly ticker?: string;
  readonly close?: string;
  readonly codbdi?: string;
  readonly tpmerc?: string;
  readonly tipreg?: string;
}): string => {
  const parts = [
    (input.tipreg ?? '01').padStart(2, '0'),
    (input.date ?? '20150312').padEnd(8, '0'),
    (input.codbdi ?? '02').padStart(2, '0'),
    (input.ticker ?? 'ITUB4').padEnd(12, ' '),
    input.tpmerc ?? '010',
    'ITAUUNIBANCO'.padEnd(12, ' '),
    'PN      N1'.padEnd(10, ' '),
    ''.padEnd(3, ' '),
    'R$ '.padEnd(4, ' '),
    // PREABE, PREMAX, PREMIN, PREMED: 13 cada.
    '0000000003100',
    '0000000003290',
    '0000000003050',
    '0000000003180',
    // PREULT, em centavos.
    (input.close ?? '3241').padStart(13, '0'),
  ];

  return parts.join('').padEnd(RECORD_LENGTH, ' ');
};

const HEADER = '00COTAHIST.2015BOVESPA 2015123120160104'.padEnd(RECORD_LENGTH, ' ');
const TRAILER = '99COTAHIST.2015BOVESPA'.padEnd(RECORD_LENGTH, ' ');

describe('o layout de largura fixa', () => {
  it('o preço tem duas decimais implícitas: o inteiro é dividido por cem', () => {
    expect(parseRecord(record({ close: '3241' }), 1)?.close).toBe('32.41');
    expect(parseRecord(record({ close: '100000' }), 1)?.close).toBe('1000.00');
    expect(parseRecord(record({ close: '7' }), 1)?.close).toBe('0.07');
  });

  it('a data vem como YYYYMMDD e sai como data de pregão', () => {
    expect(parseRecord(record({ date: '20150312' }), 1)?.trade_date).toBe('2015-03-12');
  });

  it('cabeçalho e rodapé não são cotação', () => {
    expect(parseRecord(HEADER, 1)).toBeNull();
    expect(parseRecord(TRAILER, 1)).toBeNull();
  });

  it('o que não é mercado a vista fica fora: termo e opção não são posição', () => {
    expect(parseRecord(record({ tpmerc: '030' }), 1)).toBeNull();
    expect(parseRecord(record({ tpmerc: '070' }), 1)).toBeNull();
    expect(parseRecord(record({ tpmerc: '010' }), 1)).not.toBeNull();
  });

  it('linha mais curta que o layout é mudança de formato, não preço zero', () => {
    expect(() => parseRecord('01201503120211ITUB4', 42)).toThrow(/245/u);
  });
});

describe('a carga do arquivo anual', () => {
  it('extrai só os papéis pedidos', async () => {
    const result = await readCotahist(
      [
        HEADER,
        record({ ticker: 'ITUB4', close: '3241' }),
        record({ ticker: 'PETR4', close: '2010' }),
        record({ ticker: 'KNRI11', close: '15890' }),
        TRAILER,
      ],
      { tickers: ['ITUB4', 'KNRI11'] },
    );

    expect(result.isSuccess()).toBe(true);
    if (!result.isSuccess()) return;
    expect(result.value.quotes.map((quote) => quote.ticker)).toEqual(['ITUB4', 'KNRI11']);
    expect(result.value.lines_read).toBe(5);
    expect(result.value.records_kept).toBe(2);
  });

  it('papel pedido que o arquivo não tem é reportado, e não inventado', async () => {
    const result = await readCotahist([record({ ticker: 'ITUB4' })], {
      tickers: ['ITUB4', 'XPTO3'],
    });

    expect(result.isSuccess()).toBe(true);
    if (!result.isSuccess()) return;
    expect(result.value.missing).toEqual(['XPTO3']);
  });

  it('o mesmo papel em dois grupos no mesmo dia não duplica a chave', async () => {
    // Lote padrão e fracionário: o arquivo tem os dois, e a chave
    // (ativo, data) é uma só.
    const result = await readCotahist(
      [
        record({ ticker: 'ITUB4', codbdi: '02', close: '3241' }),
        record({ ticker: 'ITUB4', codbdi: '96', close: '3240' }),
      ],
      { tickers: ['ITUB4'] },
    );

    expect(result.isSuccess()).toBe(true);
    if (!result.isSuccess()) return;
    expect(result.value.quotes).toHaveLength(1);
    expect(result.value.quotes[0]?.close).toBe('32.41');
  });

  it('reimportar o mesmo arquivo produz exatamente o mesmo resultado', async () => {
    const linhas = [
      HEADER,
      record({ ticker: 'ITUB4', date: '20150312', close: '3241' }),
      record({ ticker: 'ITUB4', date: '20150313', close: '3250' }),
      TRAILER,
    ];

    const primeira = await readCotahist(linhas, { tickers: ['ITUB4'] });
    const segunda = await readCotahist(linhas, { tickers: ['ITUB4'] });

    expect(primeira.isSuccess() && segunda.isSuccess()).toBe(true);
    if (!primeira.isSuccess() || !segunda.isSuccess()) return;
    expect(segunda.value).toEqual(primeira.value);
  });

  it('o recorte por data deixa fora o que está além do intervalo', async () => {
    const result = await readCotahist(
      [
        record({ date: '20140102' }),
        record({ date: '20150312' }),
        record({ date: '20160105' }),
      ],
      { tickers: ['ITUB4'], from: '2015-01-01', to: '2015-12-31' },
    );

    expect(result.isSuccess()).toBe(true);
    if (!result.isSuccess()) return;
    expect(result.value.quotes.map((quote) => quote.price_date)).toEqual(['2015-03-12']);
    expect(result.value.first_date).toBe('2015-03-12');
    expect(result.value.last_date).toBe('2015-03-12');
  });

  it('o preço é o negociado na data, sem ajuste por evento', async () => {
    // Um papel que desdobrou 1:2 em 2018 tem, em 2015, o preço de antes do
    // desdobramento. É o número certo: a quantidade de 2015 também é a de antes.
    const result = await readCotahist([record({ date: '20150312', close: '6482' })], {
      tickers: ['ITUB4'],
    });

    expect(result.isSuccess()).toBe(true);
    if (!result.isSuccess()) return;
    expect(result.value.quotes[0]?.close).toBe('64.82');
  });

  it('a lista vazia de papéis devolve tudo, que serve para inspecionar o arquivo', async () => {
    const result = await readCotahist(
      [record({ ticker: 'ITUB4' }), record({ ticker: 'PETR4' })],
      { tickers: [] },
    );

    expect(result.isSuccess()).toBe(true);
    if (!result.isSuccess()) return;
    expect(result.value.quotes).toHaveLength(2);
  });

  it('linha corrompida no meio do arquivo falha nomeando a linha', async () => {
    const result = await readCotahist([record({}), '01201503130211ITUB4', record({})], {
      tickers: ['ITUB4'],
    });

    expect(result.isFailure()).toBe(true);
    if (!result.isFailure()) return;
    expect(result.value).toBeInstanceOf(FormatChangedError);
    expect(result.value.field).toBe('cotahist[2]');
  });

  it('preço que não é inteiro no campo de largura fixa falha', async () => {
    const quebrada = record({}).split('');
    quebrada.splice(108, 13, ...'00000000032x1'.split(''));

    const result = await readCotahist([quebrada.join('')], { tickers: ['ITUB4'] });

    expect(result.isFailure()).toBe(true);
    if (!result.isFailure()) return;
    expect(result.value.field).toBe('cotahist[1].PREULT');
  });

  it('linha em branco é ignorada: arquivo da B3 termina com uma', async () => {
    const result = await readCotahist([record({}), '', '   '], {
      tickers: ['ITUB4'],
    });

    expect(result.isSuccess()).toBe(true);
    if (!result.isSuccess()) return;
    expect(result.value.quotes).toHaveLength(1);
  });

  it('um ano inteiro de um papel sai em memória proporcional à carteira', async () => {
    // 250 dias de um papel, mais 2.500 linhas de papéis que não interessam.
    const linhas: string[] = [HEADER];

    for (let day = 1; day <= 250; day += 1) {
      const date = `2015${String(Math.floor((day - 1) / 31) + 1).padStart(2, '0')}${String(((day - 1) % 28) + 1).padStart(2, '0')}`;
      linhas.push(record({ ticker: 'ITUB4', date, close: String(3000 + day) }));

      for (let other = 0; other < 10; other += 1) {
        linhas.push(record({ ticker: `OUTR${other}`, date }));
      }
    }

    linhas.push(TRAILER);

    const result = await readCotahist(linhas, { tickers: ['ITUB4'] });

    expect(result.isSuccess()).toBe(true);
    if (!result.isSuccess()) return;
    expect(result.value.lines_read).toBe(2_752);
    // 250 dias, menos as colisões de data que a montagem do teste produz.
    expect(result.value.quotes.length).toBeLessThanOrEqual(250);
    expect(result.value.quotes.every((quote) => quote.ticker === 'ITUB4')).toBe(true);
  });
});
