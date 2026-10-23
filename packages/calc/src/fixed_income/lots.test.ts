import { describe, expect, it } from 'vitest';

import type { LedgerEntry } from '../average_price/ledger.js';
import { applyLedger } from '../average_price/ledger.js';
import { lotsFromLedger, planRedemption, valueLots } from './lots.js';

const buy = (id: string, trade_date: string, amount: string): LedgerEntry => ({
  id,
  kind: 'buy',
  trade_date,
  quantity: amount,
  unit_price: '1',
  fees: '0',
  net_amount: `-${amount}`,
});

const sell = (id: string, trade_date: string, principal: string): LedgerEntry => ({
  id,
  kind: 'sell',
  trade_date,
  quantity: principal,
  unit_price: '1',
  fees: '0',
  net_amount: principal,
});

const entries = [
  buy('a1', '2024-01-02', '1000'),
  buy('a2', '2024-02-01', '500'),
  buy('a3', '2024-03-01', '200'),
];

describe('lotes da caixinha saem do livro', () => {
  it('cada aplicação abre um lote com a própria data', () => {
    const lots = lotsFromLedger(entries, 'oldest_first');

    expect(lots.map((lot) => [lot.id, lot.trade_date, lot.remaining])).toEqual([
      ['a1', '2024-01-02', '1000.00000000'],
      ['a2', '2024-02-01', '500.00000000'],
      ['a3', '2024-03-01', '200.00000000'],
    ]);
  });

  it('resgate consome o lote mais antigo primeiro e deixa o parcial', () => {
    const lots = lotsFromLedger(
      [...entries, sell('s1', '2024-04-01', '1200')],
      'oldest_first',
    );

    expect(lots.map((lot) => lot.remaining)).toEqual([
      '0.00000000',
      '300.00000000',
      '200.00000000',
    ]);
  });

  it('com a regra do mais novo primeiro o lote antigo sobrevive', () => {
    const lots = lotsFromLedger(
      [...entries, sell('s1', '2024-04-01', '300')],
      'newest_first',
    );

    expect(lots.map((lot) => lot.remaining)).toEqual([
      '1000.00000000',
      '400.00000000',
      '0.00000000',
    ]);
  });

  it('resgate não consome aplicação feita depois da data dele', () => {
    const lots = lotsFromLedger(
      [
        buy('a1', '2024-01-02', '100'),
        sell('s1', '2024-01-10', '150'),
        buy('a2', '2024-02-01', '100'),
      ],
      'oldest_first',
    );

    expect(lots.map((lot) => lot.remaining)).toEqual(['0.00000000', '100.00000000']);
  });

  it('o custo do preço médio é o principal restante, em qualquer ordem de consumo', () => {
    const book = [...entries, sell('s1', '2024-04-01', '1200')];

    expect(applyLedger(book).position.cost_basis).toBe('500.00');
    expect(applyLedger(book).position.avg_price).toBe('1.00000000');
  });

  it('lançamentos que não são aplicação nem resgate não mexem nos lotes', () => {
    const lots = lotsFromLedger(
      [
        buy('a1', '2024-01-02', '100'),
        {
          id: 'p1',
          kind: 'payout',
          trade_date: '2024-01-03',
          quantity: '0',
          unit_price: '0',
          fees: '0',
          net_amount: '5',
        },
      ],
      'oldest_first',
    );

    expect(lots).toHaveLength(1);
  });

  it('respeita a data limite e dá nome ao rascunho sem id', () => {
    const lots = lotsFromLedger(
      [
        {
          kind: 'buy',
          trade_date: '2024-01-02',
          quantity: '10',
          unit_price: '1',
          fees: '0',
          net_amount: '-10',
        },
        buy('a2', '2024-05-01', '10'),
      ],
      'oldest_first',
      { until: '2024-03-01' },
    );

    expect(lots).toHaveLength(1);
    expect(lots[0]?.id).toBe('rascunho-0');
  });

  it('lotes do mesmo dia são consumidos pelo id', () => {
    const lots = lotsFromLedger(
      [
        buy('b', '2024-01-02', '100'),
        buy('a', '2024-01-02', '100'),
        sell('s', '2024-01-03', '100'),
      ],
      'oldest_first',
    );

    expect(lots.find((lot) => lot.id === 'a')?.remaining).toBe('0.00000000');
    expect(lots.find((lot) => lot.id === 'b')?.remaining).toBe('100.00000000');
  });
});

describe('valor e IR por lote', () => {
  const lots = lotsFromLedger(entries, 'oldest_first');
  const factors = new Map([
    ['a1', '1.050000000000'],
    ['a2', '1.020000000000'],
    ['a3', '1.000000000000'],
  ]);

  const valuation = valueLots({
    lots,
    factors,
    reference_date: '2024-06-03',
    tax_regime: 'regressive',
  });

  it('cada lote vale o principal restante vezes o fator da própria data', () => {
    expect(valuation.lots.map((lot) => lot.gross_value)).toEqual([
      '1050.00',
      '510.00',
      '200.00',
    ]);
    expect(valuation.gross_value).toBe('1760.00');
    expect(Number(valuation.accrued_interest)).toBeCloseTo(
      Number(valuation.gross_value) - Number(valuation.principal),
      2,
    );
    expect(valuation.principal).toBe('1700.00');
  });

  it('a alíquota do IR vem da idade de cada lote', () => {
    // a1: 153 dias → 22,5%; a2: 123 dias → 22,5%; a3: 94 dias → 22,5%
    expect(valuation.lots.map((lot) => lot.tax_rate)).toEqual([
      '22.50',
      '22.50',
      '22.50',
    ]);
    expect(valuation.lots[0]?.tax_due).toBe('11.25');
    expect(valuation.tax_due).toBe('13.50');
    expect(valuation.net_value).toBe('1746.50');
  });

  it('lote já resgatado por inteiro não aparece', () => {
    const consumed = lotsFromLedger(
      [...entries, sell('s1', '2024-04-01', '1000')],
      'oldest_first',
    );
    const view = valueLots({
      lots: consumed,
      factors,
      reference_date: '2024-06-03',
      tax_regime: 'exempt',
    });

    expect(view.lots.map((lot) => lot.id)).toEqual(['a2', 'a3']);
    expect(view.tax_due).toBe('0.00');
  });

  it('lote sem fator informado vale o principal', () => {
    const view = valueLots({
      lots,
      factors: new Map(),
      reference_date: '2024-01-02',
      tax_regime: 'regressive',
    });

    expect(view.gross_value).toBe('1700.00');
  });
});

describe('planejar resgate da caixinha', () => {
  const lots = lotsFromLedger(entries, 'oldest_first');
  const factors = new Map([
    ['a1', '1.050000000000'],
    ['a2', '1.020000000000'],
    ['a3', '1.000000000000'],
  ]);

  const base = {
    lots,
    factors,
    rule: 'oldest_first' as const,
    redemption_date: '2024-06-03',
    tax_regime: 'regressive' as const,
  };

  it('pedido menor que o primeiro lote consome parte dele', () => {
    const plan = planRedemption({ ...base, amount: '525.00' });

    expect(plan.insufficient).toBe(false);
    expect(plan.slices).toHaveLength(1);
    expect(plan.slices[0]?.lot_id).toBe('a1');
    expect(plan.slices[0]?.closes_lot).toBe(false);
    expect(plan.slices[0]?.principal).toBe('500.00000000');
    expect(plan.slices[0]?.tax_due).toBe('5.63');
    expect(plan.gross_value).toBe('525.00');
    expect(plan.net_value).toBe('519.37');
  });

  it('pedido que passa do primeiro lote fecha ele e segue para o próximo', () => {
    const plan = planRedemption({ ...base, amount: '1200.00' });

    expect(plan.slices.map((slice) => [slice.lot_id, slice.closes_lot])).toEqual([
      ['a1', true],
      ['a2', false],
    ]);
    expect(plan.slices[1]?.gross_value).toBe('150.00');
    expect(plan.principal).toBe('1147.05882353');
  });

  it('o preço unitário reproduz o bruto quando multiplicado pelo principal', () => {
    const plan = planRedemption({ ...base, amount: '1200.00' });
    const book = [
      ...entries,
      {
        id: 's1',
        kind: 'sell' as const,
        trade_date: '2024-06-03',
        quantity: plan.principal,
        unit_price: plan.unit_price,
        fees: plan.tax_due,
        net_amount: plan.net_value,
      },
    ];
    const sale = applyLedger(book).realized[0];

    expect(sale?.proceeds).toBe(plan.net_value);
  });

  it('com o mais novo primeiro o lote de março sai antes', () => {
    const plan = planRedemption({ ...base, rule: 'newest_first', amount: '100.00' });

    expect(plan.slices[0]?.lot_id).toBe('a3');
    expect(plan.slices[0]?.tax_due).toBe('0.00');
  });

  it('pedido acima do que a caixinha vale não consome nada', () => {
    const plan = planRedemption({ ...base, amount: '2000.00' });

    expect(plan.insufficient).toBe(true);
    expect(plan.slices).toEqual([]);
    expect(plan.available_gross).toBe('1760.00');
  });

  it('pedido de valor zero é recusado', () => {
    expect(planRedemption({ ...base, amount: '0' }).insufficient).toBe(true);
  });

  it('lote aberto depois da data do resgate fica de fora', () => {
    const plan = planRedemption({
      ...base,
      redemption_date: '2024-01-15',
      amount: '10.00',
    });

    expect(plan.available_gross).toBe('1050.00');
  });

  it('em regime isento o IR é zero', () => {
    const plan = planRedemption({ ...base, tax_regime: 'exempt', amount: '525.00' });

    expect(plan.tax_due).toBe('0.00');
    expect(plan.net_value).toBe('525.00');
  });
});

describe('vencimento do lote', () => {
  const comVencimento = (id: string, date: string, amount: string, maturity: string) => ({
    ...buy(id, date, amount),
    maturity_date: maturity,
  });

  it('o lote leva o vencimento do aporte, e o da caixinha quando o aporte não tem', () => {
    const lots = lotsFromLedger(
      [
        comVencimento('a1', '2024-01-02', '100', '2029-01-02'),
        buy('a2', '2024-02-01', '100'),
      ],
      'oldest_first',
      { default_maturity: '2025-01-01' },
    );

    expect(lots.map((lot) => lot.maturity_date)).toEqual(['2029-01-02', '2025-01-01']);
  });

  it('com liquidez no vencimento o resgate pula o lote que ainda não venceu', () => {
    const lots = lotsFromLedger(
      [
        comVencimento('a1', '2024-01-02', '100', '2029-01-02'),
        comVencimento('a2', '2024-02-01', '100', '2024-06-01'),
        sell('s1', '2024-07-01', '60'),
      ],
      'oldest_first',
      { matured_only: true },
    );

    // O mais antigo (a1) está preso até 2029: o resgate sai do a2, já vencido.
    expect(lots.map((lot) => lot.remaining)).toEqual(['100.00000000', '40.00000000']);
  });

  it('planejar resgate só enxerga lote vencido quando a liquidez é no vencimento', () => {
    const lots = lotsFromLedger(
      [
        comVencimento('a1', '2024-01-02', '100', '2029-01-02'),
        comVencimento('a2', '2024-02-01', '100', '2024-06-01'),
      ],
      'oldest_first',
    );
    const factors = new Map([
      ['a1', '1.000000000000'],
      ['a2', '1.000000000000'],
    ]);

    const livre = planRedemption({
      lots,
      factors,
      amount: '150.00',
      rule: 'oldest_first',
      redemption_date: '2024-07-01',
      tax_regime: 'exempt',
    });
    const preso = planRedemption({
      lots,
      factors,
      amount: '150.00',
      rule: 'oldest_first',
      redemption_date: '2024-07-01',
      tax_regime: 'exempt',
      matured_only: true,
    });

    expect(livre.insufficient).toBe(false);
    expect(preso.insufficient).toBe(true);
    expect(preso.available_gross).toBe('100.00');
  });

  it('valorizar marca o lote vencido e o resgatável', () => {
    const lots = lotsFromLedger(
      [
        comVencimento('a1', '2024-01-02', '100', '2029-01-02'),
        comVencimento('a2', '2024-02-01', '100', '2024-06-01'),
      ],
      'oldest_first',
    );

    const view = valueLots({
      lots,
      factors: new Map(),
      reference_date: '2024-07-01',
      tax_regime: 'exempt',
      matured_only: true,
    });

    expect(view.lots.map((lot) => [lot.matured, lot.redeemable])).toEqual([
      [false, false],
      [true, true],
    ]);
  });
});

describe('liquidação do aporte', () => {
  const entries: LedgerEntry[] = [
    { ...buy('a1', '2024-01-02', '1000'), settlement_date: '2024-01-03' },
  ];
  const factors = new Map([['a1', '1.010000000000']]);

  it('o lote rende desde o aporte, mas só fica resgatável depois de liquidar', () => {
    const lots = lotsFromLedger(entries, 'oldest_first');
    const before = valueLots({
      lots,
      factors,
      reference_date: '2024-01-02',
      tax_regime: 'regressive',
    });
    const after = valueLots({
      lots,
      factors,
      reference_date: '2024-01-03',
      tax_regime: 'regressive',
    });

    expect(before.lots[0]?.settled).toBe(false);
    expect(before.lots[0]?.redeemable).toBe(false);
    expect(before.lots[0]?.elapsed_days).toBe(0);
    expect(after.lots[0]?.settled).toBe(true);
    expect(after.lots[0]?.redeemable).toBe(true);
  });

  it('o resgate não alcança o aporte que ainda não liquidou', () => {
    const lots = lotsFromLedger(entries, 'oldest_first');
    const plan = planRedemption({
      lots,
      amount: '100',
      rule: 'oldest_first',
      redemption_date: '2024-01-02',
      factors,
      tax_regime: 'regressive',
    });

    expect(plan.insufficient).toBe(true);
    expect(plan.available_gross).toBe('0.00');
  });

  it('uma venda no livro não consome lote que ainda não liquidou', () => {
    const lots = lotsFromLedger(
      [
        { ...buy('a1', '2024-01-02', '100'), settlement_date: '2024-01-03' },
        { ...buy('a2', '2024-01-01', '100'), settlement_date: '2024-01-02' },
        sell('s', '2024-01-02', '100'),
      ],
      'newest_first',
    );

    expect(lots.find((lot) => lot.id === 'a1')?.remaining).toBe('100.00000000');
    expect(lots.find((lot) => lot.id === 'a2')?.remaining).toBe('0.00000000');
  });
});
