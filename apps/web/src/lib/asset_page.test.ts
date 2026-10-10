import type { AssetPageResource } from '@patrimonio/contracts';
import { describe, expect, it } from 'vitest';

import {
  assetSlug,
  assetState,
  assetTitle,
  eventRatioLabel,
  fixedIncomeFacts,
  hasQuantityAndPrice,
  isPeriodParam,
  kindOptions,
  liquidityLabel,
  monthInitial,
  monthLabel,
  priceStamp,
  transactionsCountLabel,
  usedPayoutSlices,
} from './asset_page.js';

/**
 * T-03 · O que a página do ativo decide antes de desenhar.
 *
 * Cada caso aqui é uma decisão que erraria em silêncio: o papel que aparece
 * pelo nome errado, o bloco de renda fixa numa ação, a frase de estado vazio
 * que manda procurar no lugar errado.
 */

const identity = (
  overrides: Partial<AssetPageResource['asset']> = {},
): AssetPageResource['asset'] => ({
  asset_id: 'aaaa1111-1111-4111-8111-111111111111',
  ticker: 'ITUB4',
  name: 'Itaú Unibanco PN',
  origin: 'market',
  b3_type: 'stock',
  sector: 'Bancos',
  price_source: 'auto',
  category_id: 'cccc1111-1111-4111-8111-111111111111',
  category_name: 'Ações',
  color_token: 'class.acoes',
  category_automatic: true,
  issuer_name: null,
  archived_at: null,
  indexer: null,
  rate: null,
  issued_at: null,
  maturity_date: null,
  liquidity: null,
  liquidity_days: null,
  tax_regime: null,
  ...overrides,
});

const CDB = identity({
  asset_id: 'dddd1111-1111-4111-8111-111111111111',
  ticker: 'CDBC2028',
  name: 'CDB Prefixado Banco C 2028',
  origin: 'manual',
  b3_type: null,
  sector: null,
  issuer_name: 'Banco C',
  indexer: 'prefixed',
  rate: '14.10',
  issued_at: '2023-06-14',
  maturity_date: '2028-06-14',
  liquidity: 'at_maturity',
  tax_regime: 'regressive',
});

describe('como o papel se chama', () => {
  it('ação, FII, ETF e BDR se identificam pelo código', () => {
    expect(assetTitle(identity())).toBe('ITUB4');
    expect(assetTitle(identity({ b3_type: 'fii', ticker: 'KNRI11' }))).toBe('KNRI11');
    expect(assetSlug(identity())).toBe('itub4');
  });

  it('título de banco aparece pelo nome, e a URL usa o identificador', () => {
    // `CDB-BANCOC-20280614` é chave de banco de dados, não nome de coisa — e
    // dois CDBs do mesmo banco e vencimento são possíveis, então o apelido na
    // URL não pode ser o nome.
    expect(assetTitle(CDB)).toBe('CDB Prefixado Banco C 2028');
    expect(assetSlug(CDB)).toBe('dddd1111-1111-4111-8111-111111111111');
  });
});

describe('o bloco de renda fixa', () => {
  it('não existe numa ação: ela não tem indexador, o que é diferente de não saber', () => {
    expect(fixedIncomeFacts(identity())).toEqual([]);
  });

  it('traz remuneração, datas, carência e regime de IR', () => {
    const facts = fixedIncomeFacts(CDB);
    const porRotulo = new Map(facts.map((fact) => [fact.label, fact.value]));

    expect(porRotulo.get('Remuneração')).toBe('Pré 14,10%');
    expect(porRotulo.get('Aplicação')).toBe('14/06/2023');
    expect(porRotulo.get('Vencimento')).toBe('14/06/2028');
    expect(porRotulo.get('Carência')).toBe('no vencimento');
    expect(porRotulo.get('Imposto')).toBe('tabela regressiva');
    expect(porRotulo.get('Emissor')).toBe('Banco C');
  });

  it('a carência em D+n mostra o n, que é o que a torna uma informação', () => {
    expect(liquidityLabel('d_plus_n', 30)).toBe('D+30');
    expect(liquidityLabel('d_plus_n', null)).toBe('D+n');
    expect(liquidityLabel('daily', null)).toBe('diária');
    expect(liquidityLabel(null, null)).toBeNull();
  });

  it('título isento não mostra a tabela regressiva', () => {
    const facts = fixedIncomeFacts(
      identity({ indexer: 'cdi_pct', tax_regime: 'exempt' }),
    );

    expect(facts.find((fact) => fact.label === 'Imposto')?.value).toBe('isento');
  });
});

describe('janela do gráfico', () => {
  it('só as quatro da prancha valem; o resto cai no padrão', () => {
    expect(isPeriodParam('6m')).toBe(true);
    expect(isPeriodParam('tudo')).toBe(true);
    expect(isPeriodParam('decada')).toBe(false);
    expect(isPeriodParam(null)).toBe(false);
  });
});

describe('a grade de proventos', () => {
  const month = (over: Record<string, string> = {}) => ({
    month: '2026-03',
    dividend: '0',
    jcp: '0',
    income: '0',
    interest: '0',
    amortization: '0',
    total: '0',
    ...over,
  });

  it('a legenda só mostra a fatia que aparece em algum mês', () => {
    // Uma legenda com cinco entradas e duas barras faz procurar o que não
    // existe.
    const months = [month({ jcp: '500.00', total: '500.00' }), month()];

    expect(usedPayoutSlices(months)).toEqual(['jcp']);
  });

  it('sem provento nenhum, não há fatia', () => {
    expect(usedPayoutSlices([month(), month()])).toEqual([]);
  });

  it('o eixo é a inicial do mês, como a prancha desenha', () => {
    expect(monthInitial('2026-03')).toBe('M');
    expect(monthInitial('2025-12')).toBe('D');
    expect(monthLabel('2026-09')).toBe('set');
  });
});

describe('o filtro de lançamentos', () => {
  const facets = [
    { kind: 'buy' as const, count: 12 },
    { kind: 'payout' as const, count: 9 },
  ];

  it('"Todos" conta a soma das opções, para a contagem fechar', () => {
    const options = kindOptions(facets);

    expect(options[0]).toEqual({ value: null, label: 'Todos', count: 21 });
    expect(options[1]).toEqual({ value: 'buy', label: 'Compra', count: 12 });
  });

  it('a coluna de quantidade só existe onde quantidade vezes preço quer dizer algo', () => {
    // `0 × 0,00` num provento diria que a operação foi de nada, e não que a
    // coluna não se aplica.
    expect(hasQuantityAndPrice('buy')).toBe(true);
    expect(hasQuantityAndPrice('sell')).toBe(true);
    expect(hasQuantityAndPrice('payout')).toBe(false);
    expect(hasQuantityAndPrice('deposit')).toBe(false);
  });

  it('a contagem é escrita por extenso, e o singular é singular', () => {
    expect(transactionsCountLabel(1)).toBe('1 lançamento');
    expect(transactionsCountLabel(24)).toBe('24 lançamentos');
  });
});

describe('evento corporativo', () => {
  it('o fator é lido como foi anunciado, sem os zeros do numérico', () => {
    expect(eventRatioLabel('1.00000000', '2.00000000')).toBe('1:2');
    expect(eventRatioLabel('10.00000000', '1.00000000')).toBe('10:1');
  });
});

/* -------------------------------------------------------------------------- */

const resource = (overrides: Partial<AssetPageResource> = {}): AssetPageResource => ({
  portfolio_id: '0191e5a0-0000-7000-8000-00000000c000',
  portfolio_name: 'Longo prazo',
  as_of: '2026-10-06',
  computed_at: '2026-10-06T21:02:00.000Z',
  asset: identity(),
  price: {
    value: '36.84',
    day_change_ratio: '0.0082',
    price_health: 'fresh',
    price_date: '2026-10-06',
  },
  position: {
    unit: 'quantity',
    quantity: '500',
    avg_price: '29.10',
    cost_basis: '14550.00',
    value: '18420.00',
    open_result: '3870.00',
    open_result_ratio: '0.266',
    weight: '0.058',
    accrued_interest: '0',
    realized_result: null,
    payouts_12m: '1120.50',
    yield_on_cost_12m: '0.077',
  },
  series: {
    period: '1a',
    from: '2025-10-06',
    to: '2026-10-06',
    points: [],
    marks: [],
    adjusted: false,
    return_ratio: '0.175',
    return_with_payouts_ratio: '0.214',
  },
  payouts: { months: [], total_12m: '1120.50', upcoming: [] },
  transactions: { recent: [], total: 24, facets: [] },
  corporate_events: [],
  portfolios: [],
  custodians: [],
  ...overrides,
});

describe('o estado em que a tela abre', () => {
  it('distingue em carteira, zerado e sem fechamento nenhum', () => {
    // As três frases são diferentes, e dizer a errada manda a pessoa procurar
    // o problema no lugar errado (O-08).
    expect(assetState(resource())).toBe('held');
    expect(assetState(resource({ position: null }))).toBe('closed');
    expect(assetState(resource({ position: null, as_of: null }))).toBe('never_closed');
  });
});

describe('a ressalva de procedência', () => {
  it('diz de onde o preço veio e de que dia ele é', () => {
    expect(priceStamp(resource())).toBe('B3 06/10');
  });

  it('o preço manual e o papel sem preço se identificam', () => {
    const manual = resource({
      price: {
        value: '36.84',
        day_change_ratio: null,
        price_health: 'manual',
        price_date: '2026-10-02',
      },
    });
    expect(priceStamp(manual)).toBe('preço manual 02/10');

    const semPreco = resource({
      price: {
        value: null,
        day_change_ratio: null,
        price_health: 'missing',
        price_date: '2026-09-28',
      },
    });
    expect(priceStamp(semPreco)).toBe('sem preço · usa o custo 28/09');
  });

  it('título na curva não diz que o preço veio da B3', () => {
    const curva = resource({
      asset: CDB,
      price: {
        value: null,
        day_change_ratio: null,
        price_health: 'fresh',
        price_date: '2026-10-06',
      },
    });

    expect(priceStamp(curva)).toBe('na curva 06/10');
  });

  it('sem preço nenhum não há o que ressalvar', () => {
    const semData = resource({
      price: {
        value: null,
        day_change_ratio: null,
        price_health: null,
        price_date: null,
      },
    });

    expect(priceStamp(semData)).toBeNull();
  });
});
