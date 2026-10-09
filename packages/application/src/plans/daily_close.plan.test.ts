import { curveValue } from '@patrimonio/calc';
import type { CurveValue } from '@patrimonio/calc';
import { describe, expect, it } from 'vitest';

import { planDailyClose, totalIsReliable } from './daily_close.plan.js';
import type {
  CloseAsset,
  CloseEntry,
  DailyCloseContext,
  PriceOn,
} from './daily_close.plan.js';

const PORTFOLIO = 'cart-1';
const INSTITUTION = 'inst-1';

const buy = (
  trade_date: string,
  assetId: string,
  quantity: string,
  unitPrice: string,
  id = `${assetId}-${trade_date}`,
): CloseEntry => ({
  id,
  kind: 'buy',
  trade_date,
  quantity,
  unit_price: unitPrice,
  fees: '0',
  net_amount: `-${(Number(quantity) * Number(unitPrice)).toFixed(2)}`,
  asset_id: assetId,
  institution_id: INSTITUTION,
});

const deposit = (
  trade_date: string,
  amount: string,
  id = `dep-${trade_date}`,
): CloseEntry => ({
  id,
  kind: 'deposit',
  trade_date,
  quantity: amount,
  unit_price: '1',
  fees: '0',
  net_amount: amount,
  asset_id: 'caixa',
  institution_id: INSTITUTION,
});

const payout = (trade_date: string, assetId: string, amount: string): CloseEntry => ({
  id: `prov-${trade_date}`,
  kind: 'payout',
  trade_date,
  quantity: '0',
  unit_price: '0',
  fees: '0',
  net_amount: amount,
  payout_kind: 'dividend',
  asset_id: assetId,
  institution_id: INSTITUTION,
});

const listed = (id: string): CloseAsset => ({
  id,
  ticker: id.toUpperCase(),
  b3_type: 'stock',
  category_id: 'cat-acoes',
  institution_id: null,
  fixed_income: null,
});

const cash: CloseAsset = {
  id: 'caixa',
  ticker: 'CAIXA-BANCO',
  b3_type: 'cash',
  category_id: 'cat-caixa',
  institution_id: INSTITUTION,
  fixed_income: null,
};

const cdb: CloseAsset = {
  id: 'cdb',
  ticker: 'CDB-BANCO-20281010',
  b3_type: null,
  category_id: 'cat-posfixado',
  institution_id: null,
  fixed_income: {
    indexer: 'cdi_pct',
    rate: '112',
    issued_at: '2024-01-02',
    maturity_date: '2028-10-10',
  },
};

const price = (date: string, close: string, manual = false): PriceOn => ({
  price_date: date,
  close,
  manual,
});

const context = (overrides: Partial<DailyCloseContext> = {}): DailyCloseContext => ({
  portfolio_id: PORTFOLIO,
  reference_date: '2024-03-08',
  entries: [
    deposit('2024-03-01', '10000.00'),
    buy('2024-03-04', 'itub4', '100', '30.00'),
  ],
  assets: new Map([
    ['caixa', cash],
    ['itub4', listed('itub4')],
  ]),
  prices: new Map([['itub4', price('2024-03-08', '32.00')]]),
  curves: new Map(),
  previous: null,
  ...overrides,
});

describe('uma linha por ativo com posição aberta', () => {
  it('grava o ativo mesmo em dia sem movimento nenhum', () => {
    const plan = planDailyClose(context());

    expect(plan.positions.map((row) => row.asset_id).sort()).toEqual(['caixa', 'itub4']);
    expect(plan.positions.every((row) => row.position_date === '2024-03-08')).toBe(true);
  });

  it('o valor do ativo listado é quantidade vezes cotação', () => {
    const plan = planDailyClose(context());
    const itub4 = plan.positions.find((row) => row.asset_id === 'itub4');

    expect(itub4?.quantity).toBe('100.00000000');
    expect(itub4?.cost_basis).toBe('3000.00');
    expect(itub4?.market_value).toBe('3200.00');
    expect(itub4?.price_source_kind).toBe('fresh');
  });

  it('o caixa vale o saldo da carteira na instituição, não a soma dos aportes', () => {
    const plan = planDailyClose(context());
    const caixa = plan.positions.find((row) => row.asset_id === 'caixa');

    // Dez mil aportados menos três mil de compra: sete mil. Somar só os aportes
    // contaria o mesmo real duas vezes, e o patrimônio sairia treze mil.
    expect(caixa?.quantity).toBe('7000.00000000');
    expect(caixa?.market_value).toBe('7000.00');
    expect(caixa?.price_source_kind).toBe('fresh');
  });

  it('o total da carteira é a soma das posições', () => {
    const plan = planDailyClose(context());

    // 7.000 de caixa mais 3.200 de ITUB4.
    expect(plan.portfolio.total_value).toBe('10200.00');
  });

  it('posição zerada não gera linha de hoje e continua no histórico', () => {
    const plan = planDailyClose(
      context({
        entries: [
          deposit('2024-03-01', '10000.00'),
          buy('2024-03-04', 'itub4', '100', '30.00'),
          {
            id: 'venda',
            kind: 'sell',
            trade_date: '2024-03-06',
            quantity: '100',
            unit_price: '32.00',
            fees: '0',
            net_amount: '3200.00',
            asset_id: 'itub4',
            institution_id: INSTITUTION,
          },
        ],
      }),
    );

    expect(plan.positions.map((row) => row.asset_id)).toEqual(['caixa']);
    expect(plan.portfolio.total_value).toBe('10200.00');
  });
});

describe('saúde do preço', () => {
  it('preço da própria data é fresh', () => {
    expect(planDailyClose(context()).health.fresh).toBe(2);
    expect(totalIsReliable(planDailyClose(context()).health)).toBe(true);
  });

  it('preço mais antigo que a data é stale, e o total carrega a ressalva', () => {
    const plan = planDailyClose(
      context({ prices: new Map([['itub4', price('2024-03-05', '31.00')]]) }),
    );

    expect(
      plan.positions.find((row) => row.asset_id === 'itub4')?.price_source_kind,
    ).toBe('stale');
    expect(plan.health.stale).toBe(1);
    expect(totalIsReliable(plan.health)).toBe(false);
  });

  it('preço digitado à mão é marcado como manual', () => {
    const plan = planDailyClose(
      context({ prices: new Map([['itub4', price('2024-03-08', '31.00', true)]]) }),
    );

    expect(
      plan.positions.find((row) => row.asset_id === 'itub4')?.price_source_kind,
    ).toBe('manual');
  });

  it('ativo sem preço nenhum entra pelo custo e é marcado', () => {
    const plan = planDailyClose(context({ prices: new Map() }));
    const itub4 = plan.positions.find((row) => row.asset_id === 'itub4');

    expect(itub4?.market_value).toBe('3000.00');
    expect(itub4?.price_source_kind).toBe('missing');
    expect(plan.priced_at_cost).toEqual(['itub4']);
    // O total nunca vai a zero por falta de preço.
    expect(plan.portfolio.total_value).toBe('10000.00');
  });

  it('o estado é gravado na linha, não inferido na tela', () => {
    const plan = planDailyClose(context());

    expect(plan.positions.every((row) => typeof row.price_source_kind === 'string')).toBe(
      true,
    );
  });
});

describe('renda fixa marcada na curva', () => {
  const businessDays = ['2024-01-02', '2024-01-03', '2024-01-04', '2024-01-05'];

  const unitCurve = (reference: string, missing: readonly string[] = []): CurveValue => ({
    ...curveValue({
      principal: '1',
      issued_at: '2024-01-02',
      reference_date: reference,
      indexer: 'cdi_pct',
      rate: '112',
      business_days: businessDays,
      index_factors: businessDays.map((date) => ({
        date,
        daily_factor: '1.000401',
      })),
    }),
    missing_days: missing,
  });

  const fixedIncomeContext = (curve: CurveValue): DailyCloseContext =>
    context({
      reference_date: '2024-01-05',
      entries: [buy('2024-01-02', 'cdb', '1', '10000.00')],
      assets: new Map([['cdb', cdb]]),
      prices: new Map(),
      curves: new Map([['cdb', curve]]),
    });

  it('o valor é o custo multiplicado pelo fator da curva', () => {
    const plan = planDailyClose(fixedIncomeContext(unitCurve('2024-01-05')));
    const row = plan.positions[0];

    // Três dias úteis de CDI a 112%, sobre dez mil.
    expect(row?.cost_basis).toBe('10000.00');
    expect(Number(row?.market_value)).toBeGreaterThan(10000);
    expect(row?.accrued_interest).toBe((Number(row?.market_value) - 10000).toFixed(2));
    expect(row?.price_source_kind).toBe('fresh');
  });

  it('buraco na série do indexador marca a linha, sem impedir a marcação', () => {
    const plan = planDailyClose(
      fixedIncomeContext(unitCurve('2024-01-05', ['2024-01-04'])),
    );

    expect(plan.positions[0]?.price_source_kind).toBe('stale');
    expect(plan.health.stale).toBe(1);
  });

  it('título sem curva carregada entra pelo custo, não por zero', () => {
    const plan = planDailyClose(
      context({
        reference_date: '2024-01-05',
        entries: [buy('2024-01-02', 'cdb', '1', '10000.00')],
        assets: new Map([['cdb', cdb]]),
        prices: new Map(),
        curves: new Map(),
      }),
    );

    expect(plan.positions[0]?.market_value).toBe('10000.00');
    expect(plan.positions[0]?.price_source_kind).toBe('missing');
  });
});

describe('a linha da carteira', () => {
  it('o aporte do dia é fluxo, e não rendimento', () => {
    const plan = planDailyClose(
      context({
        reference_date: '2024-03-01',
        entries: [deposit('2024-03-01', '10000.00')],
        assets: new Map([['caixa', cash]]),
        prices: new Map(),
      }),
    );

    expect(plan.portfolio.net_flow).toBe('10000.00');
    expect(plan.portfolio.income).toBe('0.00');
    expect(plan.portfolio.quota_value).toBe('1.000000000000');
    expect(plan.portfolio.cumulative_contributions).toBe('10000.00');
  });

  it('o rendimento do dia é a variação menos o fluxo', () => {
    const plan = planDailyClose(
      context({
        previous: {
          position_date: '2024-03-07',
          total_value: '10000.00',
          quota_value: '1.000000000000',
          quota_count: '10000.000000000000',
          cumulative_contributions: '10000.00',
        },
      }),
    );

    expect(plan.portfolio.net_flow).toBe('0.00');
    expect(plan.portfolio.income).toBe('200.00');
    expect(plan.portfolio.quota_count).toBe('10000.000000000000');
  });

  it('o provento do dia aparece destacado dentro do rendimento', () => {
    const plan = planDailyClose(
      context({
        entries: [
          deposit('2024-03-01', '10000.00'),
          buy('2024-03-04', 'itub4', '100', '30.00'),
          payout('2024-03-08', 'itub4', '120.00'),
        ],
        previous: {
          position_date: '2024-03-07',
          total_value: '10000.00',
          quota_value: '1.000000000000',
          quota_count: '10000.000000000000',
          cumulative_contributions: '10000.00',
        },
      }),
    );

    expect(plan.portfolio.payouts).toBe('120.00');
  });

  it('transferência não entra como aporte: o patrimônio total não muda', () => {
    const plan = planDailyClose(
      context({
        entries: [
          deposit('2024-03-01', '10000.00'),
          buy('2024-03-04', 'itub4', '100', '30.00'),
          {
            id: 'transf',
            kind: 'transfer',
            trade_date: '2024-03-08',
            quantity: '20',
            unit_price: '30.00',
            fees: '0',
            net_amount: '600.00',
            asset_id: 'itub4',
            institution_id: INSTITUTION,
          },
        ],
        previous: {
          position_date: '2024-03-07',
          total_value: '10000.00',
          quota_value: '1.000000000000',
          quota_count: '10000.000000000000',
          cumulative_contributions: '10000.00',
        },
      }),
    );

    expect(plan.portfolio.net_flow).toBe('0.00');
    expect(plan.portfolio.cumulative_contributions).toBe('10000.00');

    // A perna que entra traz o custo da posição, não dinheiro: o caixa fica onde
    // estava, e o patrimônio sobe pelo ativo recebido.
    expect(plan.positions.find((row) => row.asset_id === 'caixa')?.market_value).toBe(
      '7000.00',
    );
    expect(plan.positions.find((row) => row.asset_id === 'itub4')?.cost_basis).toBe(
      '3600.00',
    );
    expect(plan.portfolio.total_value).toBe('10840.00');
  });

  it('carteira sem posição nenhuma fecha com zero, não com erro', () => {
    const plan = planDailyClose(
      context({ entries: [], assets: new Map(), prices: new Map() }),
    );

    expect(plan.positions).toEqual([]);
    expect(plan.portfolio.total_value).toBe('0.00');
    expect(Number(plan.portfolio.quota_value)).toBeGreaterThan(0);
  });
});
