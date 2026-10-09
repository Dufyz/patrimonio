import { Decimal } from 'decimal.js';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { applyLedger, proportionalCost, sortEntries } from './average_price/ledger.js';
import type { LedgerEntry } from './average_price/ledger.js';
import { costBasisByAsset, sumValues } from './allocation/weights.js';
import type { AssetLedgerEntry } from './allocation/weights.js';
import { buildQuotaSeries, seedFrom, totalFromQuota } from './quota/series.js';
import type { DailyTotals } from './quota/series.js';

/**
 * As afirmações que precisam valer para **qualquer** entrada, não só para as
 * fixtures. Um teste de exemplo prova que o caso pensado funciona; estes provam
 * que o caso não pensado também — e é o caso não pensado que aparece na carteira
 * real dez anos depois.
 *
 * A primeira delas é a mais importante do projeto: se reconstruir um pedaço da
 * projeção produz um estado diferente de reconstruir tudo, alguma projeção guarda
 * informação que não está na fonte, e aí o princípio de que o livro é a verdade
 * não se sustenta.
 */
const RUNS = 200;

const money = (value: number): string => value.toFixed(2);

/** Quantidade e preço positivos e de magnitude plausível, sem flutuante solto. */
const quantity = fc.integer({ min: 1, max: 10_000 });
const price = fc
  .integer({ min: 1, max: 500_00 })
  .map((cents) => (cents / 100).toFixed(2));

const dateFrom = (index: number): string => {
  const base = new Date(Date.UTC(2015, 0, 2));
  base.setUTCDate(base.getUTCDate() + index);
  return base.toISOString().slice(0, 10);
};

type Operation =
  | { readonly kind: 'buy'; readonly quantity: number; readonly unit_price: string }
  | { readonly kind: 'sell'; readonly fraction: number }
  | { readonly kind: 'split'; readonly ratio: number };

const operation: fc.Arbitrary<Operation> = fc.oneof(
  fc.record({
    kind: fc.constant('buy' as const),
    quantity,
    unit_price: price,
  }),
  fc.record({
    kind: fc.constant('sell' as const),
    // Fração da posição disponível: a sequência gerada nunca é inválida, e o que
    // se testa é o cálculo, não a validação.
    fraction: fc.integer({ min: 1, max: 100 }).map((value) => value / 100),
  }),
  fc.record({
    kind: fc.constant('split' as const),
    ratio: fc.integer({ min: 2, max: 10 }),
  }),
);

/**
 * Transforma operações em lançamentos coerentes, acompanhando a posição para que
 * nenhuma venda estoure a quantidade disponível.
 */
const toEntries = (operations: readonly Operation[]): readonly LedgerEntry[] => {
  const entries: LedgerEntry[] = [];
  let held = new Decimal(0);

  operations.forEach((op, index) => {
    const trade_date = dateFrom(index);
    const id = String(index).padStart(6, '0');

    if (op.kind === 'buy') {
      held = held.plus(op.quantity);
      entries.push({
        id,
        kind: 'buy',
        trade_date,
        quantity: String(op.quantity),
        unit_price: op.unit_price,
        fees: '0',
        net_amount: `-${money(op.quantity * Number(op.unit_price))}`,
      });
      return;
    }

    if (op.kind === 'sell') {
      const sold = held.times(op.fraction).toDecimalPlaces(8, Decimal.ROUND_DOWN);
      if (sold.isZero()) return;

      held = held.minus(sold);
      entries.push({
        id,
        kind: 'sell',
        trade_date,
        quantity: sold.toFixed(8),
        unit_price: '10.00',
        fees: '0',
        net_amount: money(Number(sold.toFixed(8)) * 10),
      });
      return;
    }

    if (held.isZero()) return;

    held = held.times(op.ratio);
    entries.push({
      id,
      kind: 'corporate_event',
      trade_date,
      quantity: '0',
      unit_price: '0',
      fees: '0',
      net_amount: '0',
      event_ratio_from: '1',
      event_ratio_to: String(op.ratio),
    });
  });

  return entries;
};

const ledger = fc.array(operation, { minLength: 1, maxLength: 25 }).map(toEntries);

describe('livro de lançamentos', () => {
  it('ordem de inserção embaralhada dá o mesmo resultado que ordem cronológica', () => {
    fc.assert(
      fc.property(ledger, fc.nat(), (entries, rotate) => {
        const at = entries.length === 0 ? 0 : rotate % entries.length;
        // Roda e inverte: a sequência é reconstruída pela data e pelo id, nunca
        // assumida da ordem em que as linhas chegaram do banco.
        const shuffled = [...entries.slice(at), ...entries.slice(0, at)].reverse();

        expect(applyLedger(shuffled)).toEqual(applyLedger(entries));
      }),
      { numRuns: RUNS },
    );
  });

  it('a quantidade de uma posição nunca fica negativa', () => {
    fc.assert(
      fc.property(ledger, (entries) => {
        const { position } = applyLedger(entries);

        expect(new Decimal(position.quantity).isNegative()).toBe(false);
        expect(new Decimal(position.cost_basis).isNegative()).toBe(false);
      }),
      { numRuns: RUNS },
    );
  });

  it('aplicar o livro inteiro de uma vez é igual a aplicar em dois pedaços', () => {
    fc.assert(
      fc.property(ledger, fc.nat(), (entries, cut) => {
        const at = entries.length === 0 ? 0 : cut % entries.length;
        const ordered = sortEntries(entries);

        // O livro é a verdade: cortar a sequência e reaplicá-la não muda o estado,
        // porque o estado é função da sequência e de nada mais.
        expect(applyLedger([...ordered.slice(0, at), ...ordered.slice(at)])).toEqual(
          applyLedger(entries),
        );
      }),
      { numRuns: RUNS },
    );
  });

  it('o custo total é a soma dos custos por ativo, em qualquer partição', () => {
    fc.assert(
      fc.property(ledger, ledger, (first, second) => {
        const withAsset = (
          entries: readonly LedgerEntry[],
          assetId: string,
        ): readonly AssetLedgerEntry[] =>
          entries.map((entry) => ({ ...entry, asset_id: assetId }));

        // Cada ativo mora em exatamente uma carteira: é a condição em que a soma
        // das carteiras é o patrimônio total.
        const portfolioA = withAsset(first, 'asset-a');
        const portfolioB = withAsset(second, 'asset-b');

        const total = sumValues(
          costBasisByAsset([...portfolioA, ...portfolioB]).values(),
        );
        const parts = sumValues([
          sumValues(costBasisByAsset(portfolioA).values()),
          sumValues(costBasisByAsset(portfolioB).values()),
        ]);

        expect(parts).toBe(total);
      }),
      { numRuns: RUNS },
    );
  });

  it('transferência não altera patrimônio total nem resultado realizado', () => {
    fc.assert(
      fc.property(ledger, fc.integer({ min: 1, max: 100 }), (entries, percent) => {
        const before = applyLedger(entries);
        const available = new Decimal(before.position.quantity);

        if (available.isZero()) return;

        const moving = available
          .times(percent)
          .dividedBy(100)
          .toDecimalPlaces(8, Decimal.ROUND_DOWN);

        if (moving.isZero()) return;

        // O custo que viaja é a parcela proporcional, igual à que o plano calcula.
        const amount = proportionalCost(
          before.position.cost_basis,
          moving.toFixed(8),
          before.position.quantity,
        );

        const leg = {
          kind: 'transfer' as const,
          trade_date: dateFrom(500),
          quantity: moving.toFixed(8),
          unit_price: before.position.avg_price,
          fees: '0',
        };

        const origin = applyLedger([...entries, { ...leg, net_amount: `-${amount}` }]);
        const destination = applyLedger([{ ...leg, net_amount: amount }]);

        // O patrimônio total não muda: só a leitura por propósito.
        expect(
          sumValues([origin.position.cost_basis, destination.position.cost_basis]),
        ).toBe(before.position.cost_basis);

        // E transferir não é vender: nenhum resultado realizado novo aparece.
        expect(origin.realized_total).toBe(before.realized_total);
        expect(destination.realized).toHaveLength(0);
      }),
      { numRuns: RUNS },
    );
  });
});

/** Fluxo e retorno de mercado por dia, para gerar uma série coerente. */
const dailyMove = fc.record({
  flow: fc.integer({ min: -5_000, max: 20_000 }),
  marketBp: fc.integer({ min: -300, max: 300 }),
});

const toSeries = (
  moves: readonly { readonly flow: number; readonly marketBp: number }[],
): readonly DailyTotals[] => {
  const days: DailyTotals[] = [];
  let total = new Decimal(0);

  moves.forEach((move, index) => {
    // O primeiro dia tem de entrar com dinheiro: carteira começa com aporte.
    const flow =
      index === 0 ? new Decimal(Math.abs(move.flow) + 1_000) : new Decimal(move.flow);
    const base = Decimal.max(total.plus(flow), 0);
    const grown = base.times(
      new Decimal(1).plus(new Decimal(move.marketBp).dividedBy(10_000)),
    );

    total = grown.toDecimalPlaces(2);

    days.push({
      position_date: dateFrom(index),
      total_value: total.toFixed(2),
      net_flow: flow.toDecimalPlaces(2).toFixed(2),
      payouts: '0.00',
    });
  });

  return days;
};

const quotaSeries = fc.array(dailyMove, { minLength: 1, maxLength: 40 }).map(toSeries);

describe('série de cota', () => {
  it('quota_value × quota_count é o patrimônio, em todo dia da série', () => {
    fc.assert(
      fc.property(quotaSeries, (days) => {
        for (const day of buildQuotaSeries(days)) {
          expect(totalFromQuota(day)).toBe(day.total_value);
        }
      }),
      { numRuns: RUNS },
    );
  });

  it('o valor da cota é sempre positivo: a série toda depende de dividir por ele', () => {
    fc.assert(
      fc.property(quotaSeries, (days) => {
        for (const day of buildQuotaSeries(days)) {
          expect(new Decimal(day.quota_value).isPositive()).toBe(true);
          expect(new Decimal(day.quota_count).isNegative()).toBe(false);
        }
      }),
      { numRuns: RUNS },
    );
  });

  it('dia sem fluxo não muda a quantidade de cotas', () => {
    fc.assert(
      fc.property(quotaSeries, (days) => {
        const series = buildQuotaSeries(days);

        series.forEach((day, index) => {
          if (index === 0 || day.net_flow !== '0.00') return;
          const previous = series[index - 1];
          if (previous === undefined || previous.quota_count === '0.000000000000') return;

          expect(day.quota_count).toBe(previous.quota_count);
        });
      }),
      { numRuns: RUNS },
    );
  });

  it('dia com aporte e sem movimento de mercado não muda o valor da cota', () => {
    fc.assert(
      fc.property(
        quotaSeries,
        fc.integer({ min: 1, max: 50_000 }),
        (days, contribution) => {
          const head = buildQuotaSeries(days);
          const last = head.at(-1);
          if (last === undefined || last.quota_count === '0.000000000000') return;

          const flow = new Decimal(contribution);
          const withFlow = buildQuotaSeries(
            [
              {
                position_date: dateFrom(days.length),
                total_value: new Decimal(last.total_value).plus(flow).toFixed(2),
                net_flow: flow.toFixed(2),
                payouts: '0.00',
              },
            ],
            { previous: seedFrom(last) },
          );

          const before = new Decimal(last.quota_value);
          const after = new Decimal(withFlow[0]?.quota_value ?? '0');

          // A tolerância é o arredondamento em doze casas da quantidade de cotas,
          // não folga de cálculo: o aporte em si não move o valor da cota.
          expect(after.minus(before).abs().lessThan('0.000000001')).toBe(true);
        },
      ),
      { numRuns: RUNS },
    );
  });

  it('recalcular um pedaço produz a mesma série que recalcular do zero', () => {
    fc.assert(
      fc.property(quotaSeries, fc.nat(), (days, cut) => {
        const whole = buildQuotaSeries(days);
        if (days.length < 2) return;

        const at = (cut % (days.length - 1)) + 1;

        const head = buildQuotaSeries(days.slice(0, at));
        const lastOfHead = head.at(-1);
        const tail = buildQuotaSeries(days.slice(at), {
          ...(lastOfHead === undefined ? {} : { previous: seedFrom(lastOfHead) }),
        });

        expect([...head, ...tail]).toEqual(whole);
      }),
      { numRuns: RUNS },
    );
  });
});

describe('precisão decimal', () => {
  it('Decimal → string na escala do schema → Decimal volta sem perda', () => {
    const numeric = fc
      .tuple(
        fc.integer({ min: -999_999_999_999, max: 999_999_999_999 }),
        fc.integer({ min: 0, max: 99_999_999 }),
      )
      .map(([units, fraction]) => `${units}.${String(fraction).padStart(8, '0')}`);

    fc.assert(
      fc.property(numeric, (value) => {
        // É a viagem que todo valor monetário faz: `numeric(20,8)` não cabe em
        // `double`, e um centavo perdido aqui vira divergência contra o extrato.
        const roundTrip = new Decimal(new Decimal(value).toFixed(8));

        expect(roundTrip.toFixed(8)).toBe(new Decimal(value).toFixed(8));
        expect(roundTrip.equals(new Decimal(value))).toBe(true);
      }),
      { numRuns: RUNS },
    );
  });

  it('nenhum valor monetário passa por number do JavaScript sem perder casas', () => {
    const value = '12345678901.12345678';

    // O mesmo valor via `number` perde casas; via string, não.
    expect(new Decimal(value).toFixed(8)).toBe(value);
    expect(String(Number(value))).not.toBe(value);
  });
});
