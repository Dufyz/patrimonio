import type { DateOnly, PriceableAsset } from '@patrimonio/domain';
import { describe, expect, it } from 'vitest';

import type { SourcedClosing, TreasuryQuote } from '../interfaces/market_data.js';
import {
  PRICE_MISSING_RULE,
  PRICE_STALE_RULE,
  planBackfillWindow,
  planMarketIngestion,
} from './market.plan.js';
import type { MarketIngestionContext } from './market.plan.js';

const DATE = '2026-10-06' as DateOnly;

const listed = (ticker: string, id = ticker.toLowerCase()): PriceableAsset => ({
  asset_id: id,
  ticker,
  b3_type: 'stock',
  first_trade_date: '2015-03-12' as DateOnly,
  indexer: null,
  maturity_date: null,
});

const treasuryAsset: PriceableAsset = {
  asset_id: 'tesouro-ipca-2029',
  ticker: 'TESOURO-IPCA-2029',
  b3_type: 'treasury',
  first_trade_date: '2024-01-02' as DateOnly,
  indexer: 'ipca_plus',
  maturity_date: '2029-05-15' as DateOnly,
};

const closing = (overrides: Partial<SourcedClosing> = {}): SourcedClosing => ({
  quotes: [{ ticker: 'ITUB4', price_date: DATE, close: '32.41' }],
  missing: [],
  source: 'brapi',
  source_kind: 'primary',
  requests: 1,
  ...overrides,
});

const treasuryQuote: TreasuryQuote = {
  kind: 'ipca_plus',
  maturity_date: '2029-05-15' as DateOnly,
  quote_date: DATE,
  buy_price: '2985.42',
  sell_price: '2971.08',
  buy_rate: '7.42',
  sell_rate: '7.56',
};

const context = (
  overrides: Partial<MarketIngestionContext> = {},
): MarketIngestionContext => ({
  reference_date: DATE,
  assets: [listed('ITUB4')],
  closing: closing(),
  index_quotes: [],
  treasury: [],
  treasury_source: 'tesouro-direto',
  treasury_source_kind: 'primary',
  stale_after_days: 3,
  latest_known: new Map(),
  ...overrides,
});

describe('o que vai para asset_price', () => {
  it('o preço carrega a fonte e quem respondeu', () => {
    const plan = planMarketIngestion(context());

    expect(plan.prices).toEqual([
      {
        asset_id: 'itub4',
        price_date: DATE,
        close: '32.41',
        source: 'brapi',
        source_kind: 'primary',
      },
    ]);
  });

  it('quando a alternativa respondeu, o preço nasce marcado como fallback', () => {
    const plan = planMarketIngestion(
      context({ closing: closing({ source: 'usebolsai', source_kind: 'fallback' }) }),
    );

    expect(plan.prices[0]?.source_kind).toBe('fallback');
    expect(plan.prices[0]?.source).toBe('usebolsai');
  });

  it('a data gravada é a que a fonte devolveu, não a pedida', () => {
    // Papel sem negócio hoje: a fonte devolve o último fechamento, e gravar com
    // a data de hoje faria um preço velho parecer novo.
    const plan = planMarketIngestion(
      context({
        closing: closing({
          quotes: [
            { ticker: 'ITUB4', price_date: '2026-10-02' as DateOnly, close: '32.00' },
          ],
        }),
      }),
    );

    expect(plan.prices[0]?.price_date).toBe('2026-10-02');
  });

  it('ativo sem cotação não gera linha: ausência nunca vira zero', () => {
    const plan = planMarketIngestion(
      context({
        assets: [listed('ITUB4'), listed('XPTO3')],
        closing: closing({ missing: ['XPTO3'] }),
      }),
    );

    expect(plan.prices).toHaveLength(1);
    expect(plan.missing.map((asset) => asset.ticker)).toEqual(['XPTO3']);
    expect(plan.prices.some((price) => price.close === '0')).toBe(false);
  });

  it('toda a cadeia fora do ar não grava preço nenhum', () => {
    const plan = planMarketIngestion(
      context({
        closing: closing({ quotes: [], source: 'none', source_kind: 'none' }),
      }),
    );

    expect(plan.prices).toEqual([]);
    expect(plan.missing).toHaveLength(1);
  });
});

describe('título público', () => {
  it('é casado por indexador e vencimento, não por nome', () => {
    const plan = planMarketIngestion(
      context({ assets: [treasuryAsset], treasury: [treasuryQuote] }),
    );

    expect(plan.prices).toHaveLength(1);
    expect(plan.prices[0]?.asset_id).toBe('tesouro-ipca-2029');
  });

  it('o valor da posição é o preço de venda: é quanto vale se vender hoje', () => {
    const plan = planMarketIngestion(
      context({ assets: [treasuryAsset], treasury: [treasuryQuote] }),
    );

    expect(plan.prices[0]?.close).toBe('2971.08');
  });

  it('vencimento diferente não casa, e o título fica sem preço', () => {
    const plan = planMarketIngestion(
      context({
        assets: [treasuryAsset],
        treasury: [{ ...treasuryQuote, maturity_date: '2035-05-15' as DateOnly }],
      }),
    );

    expect(plan.prices).toEqual([]);
    expect(plan.missing[0]?.ticker).toBe('TESOURO-IPCA-2029');
  });

  it('fonte do Tesouro fora do ar deixa o título sem preço, e não com zero', () => {
    const plan = planMarketIngestion(
      context({
        assets: [treasuryAsset],
        treasury: [],
        treasury_source_kind: 'none',
      }),
    );

    expect(plan.prices).toEqual([]);
    expect(plan.missing).toHaveLength(1);
  });

  it('título e ação na mesma coleta são casados por caminhos diferentes', () => {
    const plan = planMarketIngestion(
      context({
        assets: [listed('ITUB4'), treasuryAsset],
        treasury: [treasuryQuote],
      }),
    );

    expect(plan.prices.map((price) => price.asset_id).sort()).toEqual([
      'itub4',
      'tesouro-ipca-2029',
    ]);
  });
});

describe('os alertas que a coleta abre', () => {
  it('papel que nunca teve preço abre alerta de preço inexistente', () => {
    const plan = planMarketIngestion(
      context({ assets: [listed('XPTO3')], closing: closing({ quotes: [] }) }),
    );

    expect(plan.findings).toHaveLength(1);
    expect(plan.findings[0]?.rule_kind).toBe(PRICE_MISSING_RULE);
    expect(plan.findings[0]?.payload).toMatchObject({ basis: 'cost' });
  });

  it('preço velho além da tolerância abre alerta de preço atrasado', () => {
    const plan = planMarketIngestion(
      context({
        assets: [listed('ITUB4')],
        closing: closing({ quotes: [] }),
        latest_known: new Map([['itub4', '2026-09-20' as DateOnly]]),
      }),
    );

    expect(plan.findings[0]?.rule_kind).toBe(PRICE_STALE_RULE);
    expect(plan.findings[0]?.payload).toMatchObject({ last_price_date: '2026-09-20' });
  });

  it('preço de ontem dentro da tolerância não abre alerta nenhum', () => {
    // A B3 não negocia todo papel todo dia, e avisar por isso treinaria o
    // usuário a ignorar o painel inteiro.
    const plan = planMarketIngestion(
      context({
        assets: [listed('ITUB4')],
        closing: closing({ quotes: [] }),
        latest_known: new Map([['itub4', '2026-10-05' as DateOnly]]),
      }),
    );

    expect(plan.findings).toEqual([]);
  });

  it('os dois alertas são distintos, porque a ação do usuário é diferente', () => {
    const plan = planMarketIngestion(
      context({
        assets: [listed('ITUB4'), listed('XPTO3')],
        closing: closing({ quotes: [] }),
        latest_known: new Map([['itub4', '2026-01-02' as DateOnly]]),
      }),
    );

    expect(plan.findings.map((finding) => finding.rule_kind).sort()).toEqual([
      PRICE_MISSING_RULE,
      PRICE_STALE_RULE,
    ]);
  });
});

describe('o relatório da coleta', () => {
  it('conta o que foi gravado, o que faltou e quanto custou', () => {
    const plan = planMarketIngestion(
      context({
        assets: [listed('ITUB4'), listed('XPTO3')],
        closing: closing({ missing: ['XPTO3'], requests: 2 }),
        index_quotes: [
          {
            index_code: 'CDI',
            quote_date: DATE,
            daily_factor: '1.000419570000',
            raw_value: '0.041957',
            source: 'bcb',
          },
        ],
      }),
    );

    expect(plan.report).toEqual({
      reference_date: DATE,
      source: 'brapi',
      source_kind: 'primary',
      priced: 1,
      missing: 1,
      indices: 1,
      treasury: 0,
      requests: 2,
    });
  });
});

describe('a janela do backfill', () => {
  const businessDays = [
    '2026-10-01',
    '2026-10-02',
    '2026-10-05',
    '2026-10-06',
  ] as DateOnly[];

  it('da primeira compra até hoje, quando não há preço nenhum', () => {
    const window = planBackfillWindow({
      first_trade_date: '2026-10-01' as DateOnly,
      reference_date: DATE,
      business_days: businessDays,
      already_priced: [],
      has_market_price: true,
    });

    expect(window).toEqual({ from: '2026-10-01', to: '2026-10-06', needed: true });
  });

  it('só o que falta: o que já tem preço não é buscado de novo', () => {
    const window = planBackfillWindow({
      first_trade_date: '2026-10-01' as DateOnly,
      reference_date: DATE,
      business_days: businessDays,
      already_priced: ['2026-10-01', '2026-10-02'] as DateOnly[],
      has_market_price: true,
    });

    expect(window).toEqual({ from: '2026-10-05', to: '2026-10-06', needed: true });
  });

  it('série completa não pede busca nenhuma', () => {
    const window = planBackfillWindow({
      first_trade_date: '2026-10-01' as DateOnly,
      reference_date: DATE,
      business_days: businessDays,
      already_priced: businessDays,
      has_market_price: true,
    });

    expect(window.needed).toBe(false);
  });

  it('buraco no meio vira um intervalo contínuo, não três pedidos', () => {
    // A fonte cobra por requisição e não por dia: pedir três trechos custa três
    // vezes mais do que pedir um.
    const window = planBackfillWindow({
      first_trade_date: '2026-10-01' as DateOnly,
      reference_date: DATE,
      business_days: businessDays,
      already_priced: ['2026-10-02'] as DateOnly[],
      has_market_price: true,
    });

    expect(window).toEqual({ from: '2026-10-01', to: '2026-10-06', needed: true });
  });

  it('renda fixa de banco não dispara backfill: não há preço de mercado dela', () => {
    const window = planBackfillWindow({
      first_trade_date: '2024-01-02' as DateOnly,
      reference_date: DATE,
      business_days: businessDays,
      already_priced: [],
      has_market_price: false,
    });

    expect(window.needed).toBe(false);
  });

  it('lançamento com data futura não pede busca', () => {
    const window = planBackfillWindow({
      first_trade_date: '2027-01-04' as DateOnly,
      reference_date: DATE,
      business_days: businessDays,
      already_priced: [],
      has_market_price: true,
    });

    expect(window.needed).toBe(false);
  });

  it('dia não útil fica fora da janela: preço só existe em dia de pregão', () => {
    const window = planBackfillWindow({
      first_trade_date: '2026-10-03' as DateOnly,
      reference_date: DATE,
      business_days: businessDays,
      already_priced: [],
      has_market_price: true,
    });

    // 03 e 04 são fim de semana: a janela começa na segunda.
    expect(window.from).toBe('2026-10-05');
  });
});
