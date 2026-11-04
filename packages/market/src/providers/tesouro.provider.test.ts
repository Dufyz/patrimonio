import { FormatChangedError, MarketDataUnavailableError } from '@patrimonio/application';
import type { DateOnly } from '@patrimonio/domain';
import { failure, success } from '@patrimonio/shared';
import { describe, expect, it } from 'vitest';

import { fixture, replying } from '../testing/recorded.js';
import {
  CSV_BLOCK_MS,
  createTesouroCsvProvider,
  kindFromName,
} from './tesouro.provider.js';

const CSV_BODY = fixture('tesouro/PrecoTaxaTesouroDireto.csv');

const DATE = '2026-10-06' as DateOnly;

const csv = (body = CSV_BODY) => createTesouroCsvProvider({ http: replying(''), body });

describe('identificação do título', () => {
  it('é por indexador, não por nome comercial', () => {
    expect(kindFromName('Tesouro IPCA+ 2029')).toBe('ipca_plus');
    expect(kindFromName('Tesouro IPCA+ com Juros Semestrais 2035')).toBe('ipca_plus');
    expect(kindFromName('Tesouro Prefixado 2027')).toBe('prefixed');
    expect(kindFromName('Tesouro Selic 2031')).toBe('selic_plus');
  });

  it('produto que a tabela não conhece devolve nulo, para ser ignorado', () => {
    expect(kindFromName('Tesouro Educa+ 2030')).toBeNull();
  });
});

describe('o histórico de um título no CSV', () => {
  const ipca2029 = {
    kind: 'ipca_plus' as const,
    coupon: false,
    maturity_date: '2029-05-15' as DateOnly,
  };

  it('devolve só o título pedido, dentro do período', async () => {
    const result = await csv().fetchHistory?.(
      ipca2029,
      '2026-10-01' as DateOnly,
      '2026-10-31' as DateOnly,
    );

    expect(result?.isSuccess()).toBe(true);
    if (result === undefined || !result.isSuccess()) return;
    expect(result.value.map((quote) => quote.quote_date).sort()).toEqual([
      '2026-10-03',
      '2026-10-06',
    ]);
    expect(result.value.every((quote) => quote.maturity_date === '2029-05-15')).toBe(
      true,
    );
  });

  it('o período corta as datas fora dele', async () => {
    const result = await csv().fetchHistory?.(
      ipca2029,
      '2026-10-05' as DateOnly,
      '2026-10-31' as DateOnly,
    );

    expect(result?.isSuccess() && result.value.map((quote) => quote.quote_date)).toEqual([
      '2026-10-06',
    ]);
  });

  it('o título com juros semestrais não entra no histórico do sem juros', async () => {
    const result = await csv().fetchHistory?.(
      { ...ipca2029, coupon: true },
      '2026-10-01' as DateOnly,
      '2026-10-31' as DateOnly,
    );

    expect(result?.isSuccess() && result.value).toEqual([]);
  });
});

describe('o CSV do Tesouro Transparente', () => {
  it('lê decimal com vírgula e data brasileira', async () => {
    const result = await csv().fetchQuotes(DATE);

    expect(result.isSuccess()).toBe(true);
    if (!result.isSuccess()) return;

    const ipca = result.value.find((quote) => quote.kind === 'ipca_plus');
    expect(ipca?.buy_price).toBe('2985.42');
    expect(ipca?.sell_price).toBe('2971.08');
    expect(ipca?.maturity_date).toBe('2029-05-15');
  });

  it('só as linhas da data pedida entram', async () => {
    const result = await csv().fetchQuotes(DATE);

    expect(result.isSuccess()).toBe(true);
    if (!result.isSuccess()) return;
    expect(result.value.every((quote) => quote.quote_date === DATE)).toBe(true);
    expect(result.value).toHaveLength(2);
  });

  it('fim de semana usa o último dia com preço, com a data em que foi cotado', async () => {
    const result = await csv().fetchQuotes('2026-10-11' as DateOnly);

    expect(result.isSuccess()).toBe(true);
    if (!result.isSuccess()) return;
    expect(result.value).toHaveLength(2);
    expect(result.value.every((quote) => quote.quote_date === '2026-10-06')).toBe(true);
  });

  it('data sem preço na janela devolve vazio', async () => {
    const result = await csv().fetchQuotes('2026-12-31' as DateOnly);

    expect(result.isSuccess() && result.value).toEqual([]);
  });

  it('a mesma data pedida duas vezes devolve exatamente as mesmas linhas', async () => {
    const primeira = await csv().fetchQuotes(DATE);
    const segunda = await csv().fetchQuotes(DATE);

    expect(primeira.isSuccess() && segunda.isSuccess()).toBe(true);
    if (!primeira.isSuccess() || !segunda.isSuccess()) return;
    expect(segunda.value).toEqual(primeira.value);
  });

  it('coluna que saiu do cabeçalho é mudança de formato, não posição errada', async () => {
    const body = CSV_BODY.replace('PU Compra Manha', 'PU Compra');

    const result = await csv(body).fetchQuotes(DATE);

    expect(result.isFailure()).toBe(true);
    if (!result.isFailure()) return;
    expect((result.value as FormatChangedError).field).toBe('csv.PU Compra Manha');
  });

  it('arquivo vazio falha em vez de devolver nada em silêncio', async () => {
    const result = await csv('').fetchQuotes(DATE);

    expect(result.isFailure()).toBe(true);
  });
});

describe('o download do CSV do Tesouro', () => {
  const countingHttp = (replies: readonly ('ok' | 'recusa')[]) => {
    let calls = 0;
    const http = async () => {
      const reply = replies[Math.min(calls, replies.length - 1)];
      calls += 1;

      return reply === 'ok'
        ? success({ status: 200, body: CSV_BODY })
        : failure(new MarketDataUnavailableError('tesouro-transparente recusou por limite de requisições'));
    };

    return { http, calls: () => calls };
  };

  it('baixa uma vez e reaproveita o arquivo nas chamadas seguintes', async () => {
    const source = countingHttp(['ok']);
    const provider = createTesouroCsvProvider({ http: source.http, now: () => 1_000 });

    await provider.fetchQuotes(DATE);
    await provider.fetchQuotes(DATE);
    await provider.fetchHistory?.(
      { kind: 'ipca_plus', coupon: false, maturity_date: '2035-05-15' as DateOnly },
      '2026-01-01' as DateOnly,
      DATE,
    );

    expect(source.calls()).toBe(1);
  });

  it('depois de uma recusa não tenta de novo dentro da janela de bloqueio', async () => {
    const source = countingHttp(['recusa', 'ok']);
    let time = 0;
    const provider = createTesouroCsvProvider({ http: source.http, now: () => time });

    expect((await provider.fetchQuotes(DATE)).isFailure()).toBe(true);
    time = CSV_BLOCK_MS - 1;
    expect((await provider.fetchQuotes(DATE)).isFailure()).toBe(true);
    expect(source.calls()).toBe(1);

    time = CSV_BLOCK_MS + 1;
    expect((await provider.fetchQuotes(DATE)).isSuccess()).toBe(true);
    expect(source.calls()).toBe(2);
  });

  it('chamadas simultâneas esperam o mesmo download', async () => {
    const source = countingHttp(['ok']);
    const provider = createTesouroCsvProvider({ http: source.http, now: () => 5 });

    await Promise.all([provider.fetchQuotes(DATE), provider.fetchQuotes(DATE)]);

    expect(source.calls()).toBe(1);
  });
});
