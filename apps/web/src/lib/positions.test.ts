import type { PositionResource } from '@patrimonio/contracts';
import { describe, expect, it } from 'vitest';

import {
  effectiveGroupBy,
  formatFullDate,
  formatShortDate,
  groupByOptions,
  indexerLabel,
  isGroupByParam,
  positionDetail,
  positionId,
  amountInputValue,
  parseAmountInput,
  positionTitle,
  positionsCountLabel,
  priceStamp,
  toGroupBy,
  toSummary,
  toTableGroups,
} from './positions.js';

const position = (overrides: Partial<PositionResource> = {}): PositionResource => ({
  portfolio_id: 'p1',
  portfolio_name: 'Longo prazo',
  asset_id: 'a1',
  ticker: 'ITUB4',
  name: 'Itaú Unibanco PN',
  origin: 'market',
  b3_type: 'stock',
  institution_id: 'i1',
  institution_name: 'Corretora A',
  category_id: 'c1',
  category_name: 'Ações',
  color_token: 'class.acoes',
  unit: 'quantity',
  quantity: '500',
  avg_price: '29.10',
  price: '36.84',
  price_health: 'fresh',
  price_date: '2026-10-06',
  value: '18420.00',
  cost_basis: '14550.00',
  open_result: '3870.00',
  open_result_ratio: '0.266',
  weight: '0.058',
  day_change_ratio: '0.004',
  return_12m_ratio: '0.214',
  dividend_yield_12m: '0.061',
  indexer: null,
  rate: null,
  maturity_date: null,
  ...overrides,
});

describe('agrupamento', () => {
  it('agrupar por carteira só é oferecido no escopo de todas elas', () => {
    expect(groupByOptions(false).map((option) => option.value)).toEqual([
      'categoria',
      'instituicao',
      'nenhum',
    ]);
    expect(groupByOptions(true).map((option) => option.value)).toContain('carteira');
  });

  it('uma URL pedindo agrupamento por carteira dentro de uma carteira volta ao padrão', () => {
    expect(effectiveGroupBy('carteira', false)).toBe('categoria');
    expect(effectiveGroupBy('carteira', true)).toBe('carteira');
    expect(effectiveGroupBy('instituicao', false)).toBe('instituicao');
  });

  it('a URL é em português e o campo da api é o nome do campo', () => {
    expect(toGroupBy('categoria')).toBe('category');
    expect(toGroupBy('instituicao')).toBe('institution');
    expect(toGroupBy('carteira')).toBe('portfolio');
    expect(toGroupBy('nenhum')).toBe('none');
  });

  it('agrupamento desconhecido na URL não é aceito', () => {
    expect(isGroupByParam('setor')).toBe(false);
    expect(isGroupByParam('categoria')).toBe(true);
  });
});

describe('coluna detalhe', () => {
  it('ação com proventos mostra o rendimento sobre o preço', () => {
    expect(positionDetail(position())).toEqual({ text: 'DY 6,1%', tone: 'neutral' });
  });

  it('título indexado mostra a remuneração contratada e o vencimento', () => {
    const detail = positionDetail(
      position({
        indexer: 'ipca_plus',
        rate: '6.82',
        maturity_date: '2035-05-15',
        dividend_yield_12m: null,
      }),
    );

    expect(detail).toEqual({ text: 'IPCA + 6,82% · 15/05/2035', tone: 'neutral' });
  });

  it('a ressalva de preço vem na frente de qualquer outra informação', () => {
    const detail = positionDetail(
      position({ price_health: 'stale', price_date: '2026-10-03' }),
    );

    expect(detail).toEqual({ text: 'preço de 03/10', tone: 'attention' });
  });

  it('ativo sem preço nenhum diz que o valor é o custo', () => {
    expect(positionDetail(position({ price_health: 'missing' }))).toEqual({
      text: 'sem preço · usa o custo',
      tone: 'attention',
    });
  });

  it('sem provento e sem indexador a coluna fica vazia, e não com zero', () => {
    expect(positionDetail(position({ dividend_yield_12m: null }))).toBeNull();
    expect(positionDetail(position({ dividend_yield_12m: '0' }))).toBeNull();
    expect(positionDetail(position({ dividend_yield_12m: '0.000000' }))).toBeNull();
  });

  it('CDI é lido como percentual do índice, e não como spread', () => {
    expect(indexerLabel('cdi_pct', '112')).toBe('112% do CDI');
    expect(indexerLabel('prefixed', '13.42')).toBe('Pré 13,42%');
    expect(indexerLabel(null, '13.42')).toBeNull();
    expect(indexerLabel('prefixed', null)).toBeNull();
  });
});

describe('datas', () => {
  it('vencimento mostra o ano inteiro e a ressalva de preço mostra só o dia', () => {
    expect(formatFullDate('2035-05-15')).toBe('15/05/2035');
    expect(formatShortDate('2026-10-03')).toBe('03/10');
  });
});

describe('o que vai para a tabela', () => {
  it('o subtotal chega pronto, e as colunas de retorno não entram nele', () => {
    const summary = toSummary({
      count: 14,
      value: '112640.35',
      cost_basis: '102820.20',
      open_result: '9820.15',
      open_result_ratio: '0.096',
      weight: '0.353',
    });

    expect(summary['valor']).toBe('112640.35');
    expect(summary['resultado']).toBe('9820.15');
    expect(summary['peso']).toBe('0.353');
    expect(summary).not.toHaveProperty('rent_12m');
    expect(summary).not.toHaveProperty('dia');
  });

  it('o grupo leva a cor como token, nunca como cor', () => {
    const [group] = toTableGroups([
      {
        key: 'c1',
        label: 'Ações',
        color_token: 'class.acoes',
        summary: {
          count: 1,
          value: '18420.00',
          cost_basis: '14550.00',
          open_result: '3870.00',
          open_result_ratio: '0.266',
          weight: '1',
        },
        positions: [position()],
      },
    ]);

    expect(group?.colorToken).toBe('class.acoes');
    expect(group?.rows).toHaveLength(1);
  });

  it('ação se identifica pelo código; título e caixa, pelo nome', () => {
    expect(positionTitle(position())).toBe('ITUB4');
    expect(
      positionTitle(
        position({ b3_type: 'treasury', ticker: 'IPCA2035', name: 'Tesouro IPCA+ 2035' }),
      ),
    ).toBe('Tesouro IPCA+ 2035');
    expect(
      positionTitle(
        position({
          b3_type: null,
          origin: 'manual',
          ticker: 'CDB-BANCOC-20280614',
          name: 'CDB Prefixado Banco C 2028',
        }),
      ),
    ).toBe('CDB Prefixado Banco C 2028');
    expect(
      positionTitle(
        position({
          b3_type: 'cash',
          ticker: 'CAIXA-CORRETORAA',
          name: 'Caixa · Corretora A',
        }),
      ),
    ).toBe('Caixa · Corretora A');
  });

  it('o mesmo papel em duas carteiras são duas linhas', () => {
    expect(positionId(position())).not.toBe(positionId(position({ portfolio_id: 'p2' })));
  });

  it('uma posição é singular', () => {
    const summary = {
      value: '1',
      cost_basis: '1',
      open_result: '0',
      open_result_ratio: null,
      weight: '1',
    };
    expect(positionsCountLabel({ ...summary, count: 1 })).toBe('1 posição');
    expect(positionsCountLabel({ ...summary, count: 28 })).toBe('28 posições');
  });
});

describe('procedência do número', () => {
  const resource = (
    overrides: Partial<Parameters<typeof priceStamp>[0]> = {},
  ): Parameters<typeof priceStamp>[0] => ({
    as_of: '2026-10-06',
    computed_at: '2026-10-06T18:02:00.000Z',
    group_by: 'category',
    groups: [],
    total: {
      count: 0,
      value: '0',
      cost_basis: '0',
      open_result: '0',
      open_result_ratio: null,
      weight: '0',
    },
    day_change_ratio: null,
    return_12m_ratio: null,
    payouts_12m: '0',
    facets: [],
    price_health: { fresh: 0, stale: 0, manual: 0, missing: 0 },
    ...overrides,
  });

  it('sem fechamento não há o que datar', () => {
    expect(priceStamp(resource({ as_of: null }))).toBeNull();
  });

  it('com fechamento, a linha diz de quando é o número', () => {
    expect(priceStamp(resource())).toContain('Posições de 06/10');
  });

  it('fechamento sem hora registrada ainda diz o dia', () => {
    expect(priceStamp(resource({ computed_at: null }))).toBe('Posições de 06/10.');
  });
});

describe('campo de valor', () => {
  it('o que se digita vira o decimal do contrato, sem passar por number', () => {
    expect(parseAmountInput('36,84')).toBe('36.84');
    expect(parseAmountInput('1.360,57')).toBe('1360.57');
    expect(parseAmountInput('36.84')).toBe('36.84');
    expect(parseAmountInput(' 2010 ')).toBe('2010');
  });

  it('texto que não é valor não vira zero: vira recusa', () => {
    expect(parseAmountInput('')).toBeNull();
    expect(parseAmountInput('trinta')).toBeNull();
    expect(parseAmountInput('36,8,4')).toBeNull();
  });

  it('o campo abre com o preço de hoje em pt-BR', () => {
    expect(amountInputValue('36.84000000')).toBe('36,84');
    expect(amountInputValue(null)).toBe('');
  });
});
