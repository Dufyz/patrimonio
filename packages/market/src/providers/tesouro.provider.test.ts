import { FormatChangedError, MarketDataUnavailableError } from '@patrimonio/application';
import type { DateOnly } from '@patrimonio/domain';
import { failure } from '@patrimonio/shared';
import { describe, expect, it } from 'vitest';

import { createTreasuryChain } from '../chain.js';
import { fixture, replying } from '../testing/recorded.js';
import {
  createTesouroCsvProvider,
  createTesouroJsonProvider,
  kindFromName,
} from './tesouro.provider.js';

const JSON_BODY = fixture('tesouro/treasurybondsinfo.json');
const CSV_BODY = fixture('tesouro/PrecoTaxaTesouroDireto.csv');

const DATE = '2026-10-06' as DateOnly;

const json = (body = JSON_BODY) => createTesouroJsonProvider({ http: replying(body) });
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

describe('o JSON do site do Tesouro', () => {
  it('lê os três títulos conhecidos com as duas pontas separadas', async () => {
    const result = await json().fetchQuotes(DATE);

    expect(result.isSuccess()).toBe(true);
    if (!result.isSuccess()) return;

    expect(result.value).toHaveLength(3);
    const ipca = result.value.find((quote) => quote.kind === 'ipca_plus');
    expect(ipca).toEqual({
      kind: 'ipca_plus',
      maturity_date: '2029-05-15',
      quote_date: '2026-10-06',
      buy_price: '2985.42',
      sell_price: '2971.08',
      buy_rate: '7.42',
      sell_rate: '7.56',
    });
  });

  it('título vencido para de ser coletado, sem gerar erro', async () => {
    const result = await json().fetchQuotes(DATE);

    expect(result.isSuccess()).toBe(true);
    if (!result.isSuccess()) return;
    expect(result.value.some((quote) => quote.maturity_date === '2024-01-01')).toBe(
      false,
    );
  });

  it('produto novo não derruba a coleta dos que existem', async () => {
    const result = await json().fetchQuotes(DATE);

    expect(result.isSuccess()).toBe(true);
    if (!result.isSuccess()) return;
    expect(result.value.map((quote) => quote.kind).sort()).toEqual([
      'ipca_plus',
      'prefixed',
      'selic_plus',
    ]);
  });

  it('data com hora no vencimento é lida sem deslocar um dia', async () => {
    const result = await json().fetchQuotes(DATE);

    expect(result.isSuccess()).toBe(true);
    if (!result.isSuccess()) return;
    expect(result.value.find((quote) => quote.kind === 'prefixed')?.maturity_date).toBe(
      '2027-01-01',
    );
  });

  it('envelope alterado falha nomeando o caminho', async () => {
    const result = await json('{"response":{"TrsrBdList":[]}}').fetchQuotes(DATE);

    expect(result.isFailure()).toBe(true);
    if (!result.isFailure()) return;
    expect((result.value as FormatChangedError).field).toBe('response.TrsrBdTradgList');
  });

  it('preço que virou texto não numérico falha nomeando o título', async () => {
    const body = JSON_BODY.replace('2985.42', '"indisponível"');

    const result = await json(body).fetchQuotes(DATE);

    expect(result.isFailure()).toBe(true);
    if (!result.isFailure()) return;
    expect((result.value as FormatChangedError).field).toMatch(/untrInvstmtVal/u);
  });

  it('corpo vazio falha, e não devolve lista vazia', async () => {
    const result = await json('').fetchQuotes(DATE);

    expect(result.isFailure()).toBe(true);
    if (!result.isFailure()) return;
    expect(result.value).toBeInstanceOf(FormatChangedError);
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

describe('a cadeia do Tesouro', () => {
  it('o JSON responde e o CSV não é chamado', async () => {
    let csvChamado = false;

    const chain = createTreasuryChain([
      json(),
      {
        id: 'tesouro-transparente',
        fetchQuotes: async () => {
          csvChamado = true;
          return failure(new MarketDataUnavailableError('x'));
        },
      },
    ]);

    const result = await chain.fetchQuotes(DATE);

    expect(result.isSuccess()).toBe(true);
    if (!result.isSuccess()) return;
    expect(result.value.source).toBe('tesouro-direto');
    expect(result.value.source_kind).toBe('primary');
    expect(csvChamado).toBe(false);
  });

  it('JSON fora do ar cai para o CSV e o preço nasce como fallback', async () => {
    const chain = createTreasuryChain([
      {
        id: 'tesouro-direto',
        fetchQuotes: async () => failure(new MarketDataUnavailableError('503')),
      },
      csv(),
    ]);

    const result = await chain.fetchQuotes(DATE);

    expect(result.isSuccess()).toBe(true);
    if (!result.isSuccess()) return;
    expect(result.value.source).toBe('tesouro-transparente');
    expect(result.value.source_kind).toBe('fallback');
    expect(result.value.quotes).toHaveLength(2);
  });
});
