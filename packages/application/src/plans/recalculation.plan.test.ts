import { totalFromQuota } from '@patrimonio/calc';
import { describe, expect, it } from 'vitest';

import type { CloseAsset, CloseEntry, PriceOn } from './daily_close.plan.js';
import { planRecalculation } from './recalculation.plan.js';
import type { RecalculationContext } from './recalculation.plan.js';

const PORTFOLIO = 'cart-1';
const INSTITUTION = 'inst-1';

const DAYS = [
  '2024-03-01',
  '2024-03-04',
  '2024-03-05',
  '2024-03-06',
  '2024-03-07',
  '2024-03-08',
];

const buy = (trade_date: string, quantity: string, unitPrice: string): CloseEntry => ({
  id: `buy-${trade_date}`,
  kind: 'buy',
  trade_date,
  quantity,
  unit_price: unitPrice,
  fees: '0',
  net_amount: `-${(Number(quantity) * Number(unitPrice)).toFixed(2)}`,
  asset_id: 'itub4',
  institution_id: INSTITUTION,
});

const sell = (trade_date: string, quantity: string, unitPrice: string): CloseEntry => ({
  id: `sell-${trade_date}`,
  kind: 'sell',
  trade_date,
  quantity,
  unit_price: unitPrice,
  fees: '0',
  net_amount: (Number(quantity) * Number(unitPrice)).toFixed(2),
  asset_id: 'itub4',
  institution_id: INSTITUTION,
});

const assets = new Map<string, CloseAsset>([
  [
    'itub4',
    {
      id: 'itub4',
      ticker: 'ITUB4',
      b3_type: 'stock',
      category_id: 'cat-acoes',
      fixed_income: null,
    },
  ],
]);

const prices = new Map<string, readonly PriceOn[]>([
  [
    'itub4',
    [
      { price_date: '2024-03-04', close: '30.00', manual: false },
      { price_date: '2024-03-05', close: '31.00', manual: false },
      // 06 sem preço: o dia repete o último e não inventa variação.
      { price_date: '2024-03-07', close: '33.00', manual: false },
      { price_date: '2024-03-08', close: '29.00', manual: false },
    ],
  ],
]);

const entries: readonly CloseEntry[] = [
  buy('2024-03-04', '100', '30.00'),
  sell('2024-03-07', '40', '33.00'),
];

const context = (
  overrides: Partial<RecalculationContext> = {},
): RecalculationContext => ({
  portfolio_id: PORTFOLIO,
  from_date: DAYS[0] ?? '',
  through_date: DAYS[DAYS.length - 1] ?? '',
  business_days: DAYS,
  calendar: DAYS,
  entries,
  assets,
  prices,
  index_factors: new Map(),
  previous: null,
  ...overrides,
});

describe('reconstruir do livro', () => {
  const plan = planRecalculation(context());

  it('gera uma linha de carteira por dia útil do intervalo', () => {
    expect(plan.portfolio_days.map((day) => day.position_date)).toEqual(DAYS);
    expect(plan.delete_from).toBe('2024-03-01');
  });

  it('a invariante da cota vale em todo dia da série reconstruída', () => {
    for (const day of plan.portfolio_days) {
      expect(totalFromQuota(day)).toBe(day.total_value);
    }
  });

  it('o dia sem preço novo repete o último e marca a linha', () => {
    const sexta = plan.positions.find(
      (row) => row.position_date === '2024-03-06' && row.asset_id === 'itub4',
    );

    expect(sexta?.market_value).toBe('3100.00');
    expect(sexta?.price_source_kind).toBe('stale');
  });

  it('a carteira sem posição fecha em zero, e a primeira compra é fluxo sem rendimento', () => {
    expect(plan.portfolio_days[0]?.total_value).toBe('0.00');
    expect(plan.portfolio_days[1]?.net_flow).toBe('3000.00');
    expect(plan.portfolio_days[1]?.income).toBe('0.00');
  });

  it('a venda é resgate: o fluxo do dia é negativo', () => {
    const day = plan.portfolio_days.find((row) => row.position_date === '2024-03-07');

    expect(day?.net_flow).toBe('-1320.00');
  });

  it('o relatório diz o intervalo reconstruído e quantas linhas mudaram', () => {
    expect(plan.report).toMatchObject({
      portfolio_id: PORTFOLIO,
      from_date: '2024-03-01',
      through_date: '2024-03-08',
      days: DAYS.length,
    });
    expect(plan.report.positions).toBe(plan.positions.length);
    expect(plan.report.days_with_stale_price).toBeGreaterThan(0);
  });

  it('rodar duas vezes para o mesmo intervalo produz o mesmo resultado', () => {
    expect(planRecalculation(context())).toEqual(plan);
  });
});

describe('a invariante central: do zero é igual ao incremental', () => {
  it('reconstruir o intervalo inteiro é igual a reconstruir em dois pedaços', () => {
    const whole = planRecalculation(context());

    const cut = 3;
    const head = planRecalculation(
      context({
        business_days: DAYS.slice(0, cut),
        through_date: DAYS[cut - 1] ?? '',
      }),
    );

    const lastOfHead = head.portfolio_days[head.portfolio_days.length - 1];

    const tail = planRecalculation(
      context({
        from_date: DAYS[cut] ?? '',
        business_days: DAYS.slice(cut),
        previous: lastOfHead ?? null,
      }),
    );

    expect([...head.portfolio_days, ...tail.portfolio_days]).toEqual(
      whole.portfolio_days,
    );
    expect([...head.positions, ...tail.positions]).toEqual(whole.positions);
  });

  it('reconstruir só a ponta não reescreve o que vem antes', () => {
    const tail = planRecalculation(
      context({
        from_date: '2024-03-07',
        business_days: ['2024-03-07', '2024-03-08'],
        previous: {
          position_date: '2024-03-06',
          total_value: '3100.00',
          quota_value: '1.033333333333',
          quota_count: '3000.000000000000',
          cumulative_contributions: '3000.00',
        },
      }),
    );

    expect(tail.delete_from).toBe('2024-03-07');
    expect(tail.portfolio_days.map((day) => day.position_date)).toEqual([
      '2024-03-07',
      '2024-03-08',
    ]);
  });
});

describe('resultado realizado', () => {
  it('a venda do intervalo entra, com o custo consumido pelo preço médio', () => {
    const plan = planRecalculation(context());

    expect(plan.realized).toHaveLength(1);
    expect(plan.realized[0]).toMatchObject({
      transaction_id: 'sell-2024-03-07',
      portfolio_id: PORTFOLIO,
      asset_id: 'itub4',
      trade_date: '2024-03-07',
      proceeds: '1320.00',
      cost_consumed: '1200.00',
      result: '120.00',
    });
  });

  it('sem apuração carregada a venda nasce sem isenção e sem compensação', () => {
    const plan = planRecalculation(context());

    expect(plan.realized[0]?.exempt).toBe(false);
    expect(plan.realized[0]?.loss_offset).toBe('0.00');
  });

  it('a apuração carregada decide a isenção e a compensação da venda', () => {
    const plan = planRecalculation(
      context({
        tax_annotations: new Map([
          ['sell-2024-03-07', { exempt: true, loss_offset: '50.00' }],
        ]),
      }),
    );

    expect(plan.realized[0]?.exempt).toBe(true);
    expect(plan.realized[0]?.loss_offset).toBe('50.00');
  });

  it('venda anterior ao intervalo reconstruído não é regravada', () => {
    const plan = planRecalculation(
      context({
        from_date: '2024-03-08',
        business_days: ['2024-03-08'],
      }),
    );

    expect(plan.realized).toEqual([]);
  });
});

describe('renda fixa na reconstrução', () => {
  const calendar = ['2024-01-02', '2024-01-03', '2024-01-04', '2024-01-05'];

  const cdbContext = (): RecalculationContext => ({
    portfolio_id: PORTFOLIO,
    from_date: '2024-01-02',
    through_date: '2024-01-05',
    business_days: calendar,
    calendar,
    entries: [
      {
        id: 'aplica',
        kind: 'buy',
        trade_date: '2024-01-02',
        quantity: '1',
        unit_price: '10000.00',
        fees: '0',
        net_amount: '-10000.00',
        asset_id: 'cdb',
        institution_id: INSTITUTION,
      },
    ],
    assets: new Map([
      [
        'cdb',
        {
          id: 'cdb',
          ticker: 'CDB-BANCO-20281010',
          b3_type: null,
          category_id: 'cat-posfixado',
          fixed_income: {
            indexer: 'cdi_pct' as const,
            rate: '112',
            issued_at: '2024-01-02',
            maturity_date: '2028-10-10',
          },
        },
      ],
    ]),
    prices: new Map(),
    index_factors: new Map([
      ['CDI', new Map(calendar.map((date) => [date, '1.000401']))],
    ]),
    previous: null,
  });

  it('o valor na curva cresce dia a dia e nunca recua', () => {
    const plan = planRecalculation(cdbContext());
    const values = plan.positions.map((row) => Number(row.market_value));

    expect(values[0]).toBe(10000);
    expect(values).toEqual([...values].sort((left, right) => left - right));
    expect(values[values.length - 1]).toBeGreaterThan(10000);
  });

  it('o juro corrido é a diferença entre o valor na curva e o custo', () => {
    const plan = planRecalculation(cdbContext());

    for (const row of plan.positions) {
      expect(row.accrued_interest).toBe(
        (Number(row.market_value) - Number(row.cost_basis)).toFixed(2),
      );
    }
  });

  it('sem índice publicado o título não rende e a linha é marcada', () => {
    const plan = planRecalculation({ ...cdbContext(), index_factors: new Map() });

    expect(plan.positions.every((row) => row.market_value === '10000.00')).toBe(true);
    expect(plan.report.days_with_stale_price).toBeGreaterThan(0);
  });
});

describe('caixinha na reconstrução', () => {
  const calendar = ['2024-01-02', '2024-01-03', '2024-01-04', '2024-01-05'];

  const aplicacao = (id: string, trade_date: string, amount: string): CloseEntry => ({
    id,
    kind: 'buy',
    trade_date,
    quantity: amount,
    unit_price: '1',
    fees: '0',
    net_amount: `-${amount}`,
    asset_id: 'caixinha',
    institution_id: INSTITUTION,
  });

  const caixinhaContext = (
    book: readonly CloseEntry[],
    rule: 'oldest_first' | 'newest_first' = 'oldest_first',
  ): RecalculationContext => ({
    portfolio_id: PORTFOLIO,
    from_date: '2024-01-02',
    through_date: '2024-01-05',
    business_days: calendar,
    calendar,
    entries: book,
    assets: new Map([
      [
        'caixinha',
        {
          id: 'caixinha',
          ticker: 'CDB-ITAU-CAIXINHA',
          b3_type: null,
          category_id: 'cat-posfixado',
          fixed_income: {
            indexer: 'cdi_pct' as const,
            rate: '100',
            issued_at: '2024-01-02',
            maturity_date: null,
            redemption_rule: rule,
          },
        },
      ],
    ]),
    prices: new Map(),
    index_factors: new Map([['CDI', new Map(calendar.map((date) => [date, '1.0004']))]]),
    previous: null,
  });

  const valueOn = (plan: ReturnType<typeof planRecalculation>, date: string): string =>
    plan.positions.find((row) => row.position_date === date)?.market_value ?? '';

  it('cada aplicação rende a partir da própria data, não da abertura da caixinha', () => {
    const plan = planRecalculation(
      caixinhaContext([
        aplicacao('a1', '2024-01-02', '1000'),
        aplicacao('a2', '2024-01-04', '500'),
      ]),
    );

    expect(valueOn(plan, '2024-01-03')).toBe('1000.40');
    // a2 entra no dia 4 valendo o principal, sem herdar os dois dias do lote antigo.
    expect(valueOn(plan, '2024-01-04')).toBe('1500.80');
    expect(valueOn(plan, '2024-01-05')).toBe('1501.40');
  });

  it('resgatar o lote mais antigo deixa só o lote novo rendendo', () => {
    const plan = planRecalculation(
      caixinhaContext([
        aplicacao('a1', '2024-01-02', '1000'),
        aplicacao('a2', '2024-01-04', '500'),
        {
          id: 'r1',
          kind: 'sell',
          trade_date: '2024-01-05',
          quantity: '1000',
          unit_price: '1.0012',
          fees: '0',
          net_amount: '1001.20',
          asset_id: 'caixinha',
          institution_id: INSTITUTION,
        },
      ]),
    );

    const last = plan.positions.find((row) => row.position_date === '2024-01-05');

    expect(last?.market_value).toBe('500.20');
    expect(last?.cost_basis).toBe('500.00');
    expect(plan.realized[0]?.result).toBe('1.20');
  });

  it('com a regra do mais novo primeiro o mesmo resgate preserva o lote antigo', () => {
    const plan = planRecalculation(
      caixinhaContext(
        [
          aplicacao('a1', '2024-01-02', '1000'),
          aplicacao('a2', '2024-01-04', '500'),
          {
            id: 'r1',
            kind: 'sell',
            trade_date: '2024-01-05',
            quantity: '500',
            unit_price: '1.0004',
            fees: '0',
            net_amount: '500.20',
            asset_id: 'caixinha',
            institution_id: INSTITUTION,
          },
        ],
        'newest_first',
      ),
    );

    expect(valueOn(plan, '2024-01-05')).toBe('1001.20');
  });

  it('reconstruir de um dia no meio dá o mesmo valor que reconstruir tudo', () => {
    const book = [
      aplicacao('a1', '2024-01-02', '1000'),
      aplicacao('a2', '2024-01-04', '500'),
    ];
    const full = planRecalculation(caixinhaContext(book));
    const partial = planRecalculation({
      ...caixinhaContext(book),
      from_date: '2024-01-05',
      business_days: ['2024-01-05'],
      previous: full.portfolio_days[2] ?? null,
    });

    expect(valueOn(partial, '2024-01-05')).toBe(valueOn(full, '2024-01-05'));
  });

  it('o lote vencido para de render: o valor congela no vencimento', () => {
    const plan = planRecalculation(
      caixinhaContext([
        { ...aplicacao('a1', '2024-01-02', '1000'), maturity_date: '2024-01-04' },
      ]),
    );

    expect(valueOn(plan, '2024-01-04')).toBe('1000.80');
    expect(valueOn(plan, '2024-01-05')).toBe('1000.80');
  });
});
