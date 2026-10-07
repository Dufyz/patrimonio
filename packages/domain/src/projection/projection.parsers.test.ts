import { describe, expect, it } from 'vitest';

import { assetClassFor, indexForIndexer } from './projection.entities.js';
import {
  parseAlertInstanceFromDB,
  parseAssetPriceFromDB,
  parseIndexQuoteFromDB,
  parsePortfolioDailyFromDB,
  parsePositionDailyFromDB,
  parseRealizedResultFromDB,
  parseTaxMonthFromDB,
} from './projection.parsers.js';

describe('o índice de cada indexador', () => {
  it('cada indexador aponta para a série que o remunera', () => {
    expect(indexForIndexer('cdi_pct')).toBe('CDI');
    expect(indexForIndexer('ipca_plus')).toBe('IPCA');
    expect(indexForIndexer('selic_plus')).toBe('SELIC');
  });

  it('prefixado não tem índice: a taxa contratada é a remuneração inteira', () => {
    expect(indexForIndexer('prefixed')).toBeNull();
  });
});

describe('a classe de apuração de cada papel', () => {
  it('ação, FII e ETF têm classe própria', () => {
    expect(assetClassFor('stock')).toBe('stock');
    expect(assetClassFor('fii')).toBe('fii');
    expect(assetClassFor('etf')).toBe('etf');
  });

  it('BDR compartilha o regime do ETF: 15% e sem isenção por valor de venda', () => {
    expect(assetClassFor('bdr')).toBe('etf');
  });

  it('Tesouro, caixa e título sem tipo não entram na apuração de renda variável', () => {
    expect(assetClassFor('treasury')).toBeNull();
    expect(assetClassFor('cash')).toBeNull();
    expect(assetClassFor(null)).toBeNull();
  });
});

describe('a cópia campo a campo', () => {
  it('position_daily chega com NUMERIC como string, sem perder casas', () => {
    const row = parsePositionDailyFromDB({
      portfolio_id: 'cart-1',
      asset_id: 'itub4',
      position_date: '2024-03-08',
      quantity: '100.00000000',
      avg_price: '30.09900000',
      cost_basis: '3009.90',
      market_value: '3200.00',
      price_source_kind: 'stale',
      accrued_interest: '0.00',
      computed_at: '2024-03-08T22:00:00.000Z',
      coluna_nova: 'não deve aparecer',
    });

    expect(row.avg_price).toBe('30.09900000');
    expect(row.price_source_kind).toBe('stale');
    // Coluna nova no `SELECT *` sem linha no parser não aparece na saída.
    expect('coluna_nova' in row).toBe(false);
  });

  it('portfolio_daily preserva as doze casas da cota', () => {
    const row = parsePortfolioDailyFromDB({
      portfolio_id: 'cart-1',
      position_date: '2024-03-08',
      total_value: '15000.00',
      net_flow: '0.00',
      income: '-301.00',
      payouts: '50.00',
      quota_value: '1.003311258278',
      quota_count: '14950.495049504950',
      cumulative_contributions: '15000.00',
      computed_at: '2024-03-08T22:00:00.000Z',
    });

    expect(row.quota_value).toBe('1.003311258278');
    expect(row.quota_count).toBe('14950.495049504950');
    expect(row.income).toBe('-301.00');
  });

  it('realized_result carrega a isenção e a compensação', () => {
    const row = parseRealizedResultFromDB({
      transaction_id: 'venda-1',
      portfolio_id: 'cart-1',
      asset_id: 'itub4',
      trade_date: '2024-03-07',
      proceeds: '1320.00',
      cost_consumed: '1200.00',
      result: '120.00',
      exempt: true,
      loss_offset: '50.00',
      computed_at: '2024-03-07T22:00:00.000Z',
    });

    expect(row.exempt).toBe(true);
    expect(row.loss_offset).toBe('50.00');
  });

  it('tax_month volta com ano e mês como número e os valores como string', () => {
    const row = parseTaxMonthFromDB({
      year: 2024,
      month: 3,
      asset_class: 'fii',
      sales_total: '30000.00',
      gross_result: '5000.00',
      exempt: false,
      loss_carried_forward: '0.00',
      computed_at: '2024-04-01T00:00:00.000Z',
    });

    expect(row.year).toBe(2024);
    expect(row.month).toBe(3);
    expect(row.asset_class).toBe('fii');
  });

  it('alert_instance sem payload volta com objeto vazio, não com nulo', () => {
    const row = parseAlertInstanceFromDB({
      rule_kind: 'preco_atrasado',
      subject_id: 'itub4',
      portfolio_id: null,
      status: 'snoozed',
      snooze_until: '2024-04-01',
      payload: null,
      first_seen_at: '2024-03-01T00:00:00.000Z',
      updated_at: '2024-03-08T00:00:00.000Z',
    });

    expect(row.payload).toEqual({});
    expect(row.portfolio_id).toBeNull();
    expect(row.snooze_until).toBe('2024-04-01');
  });

  it('asset_price diz de que fonte veio e quando chegou', () => {
    const row = parseAssetPriceFromDB({
      asset_id: 'itub4',
      price_date: '2024-03-08',
      close: '32.00',
      source: 'brapi',
      source_kind: 'fallback',
      fetched_at: new Date('2024-03-08T22:00:00.000Z'),
    });

    expect(row.source_kind).toBe('fallback');
    expect(row.fetched_at).toBe('2024-03-08T22:00:00.000Z');
  });

  it('index_quote guarda fator diário, e o valor cru pode faltar', () => {
    const row = parseIndexQuoteFromDB({
      index_code: 'CDI',
      quote_date: '2024-03-08',
      daily_factor: '1.000401675414',
      raw_value: null,
      source: 'bcb-sgs',
      fetched_at: '2024-03-08T22:00:00.000Z',
    });

    expect(row.daily_factor).toBe('1.000401675414');
    expect(row.raw_value).toBeNull();
  });

  it('valor de enumerado desconhecido falha em vez de passar adiante', () => {
    expect(() =>
      parsePositionDailyFromDB({
        portfolio_id: 'cart-1',
        asset_id: 'itub4',
        position_date: '2024-03-08',
        quantity: '0',
        avg_price: '0',
        cost_basis: '0',
        market_value: '0',
        price_source_kind: 'inventado',
        accrued_interest: '0',
        computed_at: '2024-03-08T22:00:00.000Z',
      }),
    ).toThrow(TypeError);
  });
});
