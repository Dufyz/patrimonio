import type { PositionResource } from '@patrimonio/contracts';
import { closedAsRow, withClosedRows } from './positions.js';
import { describe, expect, it } from 'vitest';

import {
  formatFullDate,
  effectiveGroupBy,
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
  it('as opções do seletor são categoria, instituição e sem grupo', () => {
    expect(groupByOptions(false).map((option) => option.value)).toEqual([
      'categoria',
      'instituicao',
      'nenhum',
    ]);
  });

  it('por carteira só aparece em todas as carteiras', () => {
    expect(groupByOptions(true).map((option) => option.value)).toEqual([
      'categoria',
      'instituicao',
      'carteira',
      'nenhum',
    ]);
    expect(effectiveGroupBy('carteira', true)).toBe('carteira');
    expect(effectiveGroupBy('carteira', false)).toBe('categoria');
    expect(toGroupBy('carteira')).toBe('portfolio');
  });

  it('a URL é em português e o campo da api é o nome do campo', () => {
    expect(toGroupBy('categoria')).toBe('category');
    expect(toGroupBy('instituicao')).toBe('institution');
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
    institution_facets: [],
    live: null,
    price_health: { fresh: 0, stale: 0, manual: 0, missing: 0 },
    ...overrides,
  });

  it('sem consolidação não há o que datar', () => {
    expect(priceStamp(resource({ as_of: null }))).toBeNull();
  });

  it('com consolidação, a linha diz de quando é o número', () => {
    expect(priceStamp(resource())).toContain('Posições de 06/10');
  });

  it('consolidação sem hora registrada ainda diz o dia', () => {
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

describe('encerradas na tabela', () => {
  const closed = (category: string | null, ticker: string) =>
    closedAsRow(
      {
        asset_id: '00000000-0000-4000-8000-000000000001',
        ticker,
        name: ticker,
        category_name: category,
        color_token: null,
        first_trade_date: '2020-01-01',
        closed_on: '2021-01-01',
        invested: '1',
        proceeds: '1',
        payouts_received: '0',
        realized_result: null,
        total_result: '0',
        total_result_ratio: null,
      },
      '00000000-0000-4000-8000-000000000002',
    );

  const group = (key: string, label: string) => ({
    key,
    label,
    rows: [],
    summary: {},
  });

  it('vão para o grupo da categoria; sem grupo, criam um ao fim', () => {
    const out = withClosedRows(
      [group('c1', 'Ações')],
      [closed('Ações', 'AAA3'), closed('FIIs', 'BBB11')],
      'category',
    );

    expect(out.map((item) => item.label)).toEqual(['Ações', 'FIIs']);
    expect(out[0]?.rows[0]?.closed).toBe(true);
  });

  it('em outros agrupamentos, vão para "Encerradas"', () => {
    const out = withClosedRows(
      [group('i1', 'XP')],
      [closed(null, 'CCC3')],
      'institution',
    );
    expect(out.at(-1)?.label).toBe('Encerradas');
  });
});
