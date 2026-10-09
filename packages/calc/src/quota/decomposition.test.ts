import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import { marchWithContribution, twoMonths } from '../__fixtures__/quota/series.js';
import { decomposeByMonth, yearTotals } from './decomposition.js';
import { buildQuotaSeries } from './series.js';

const months = decomposeByMonth(buildQuotaSeries(twoMonths));

describe('a identidade do mês', () => {
  it('saldo inicial + aporte líquido + rendimento = saldo final, em todo mês', () => {
    for (const month of months) {
      const closing = new Decimal(month.opening_value)
        .plus(new Decimal(month.net_flow))
        .plus(new Decimal(month.income));

      expect(closing.toFixed(2)).toBe(month.closing_value);
    }
  });

  it('o saldo inicial de um mês é o saldo final do anterior', () => {
    expect(months[1]?.opening_value).toBe(months[0]?.closing_value);
  });

  it('o primeiro mês da história começa em zero', () => {
    expect(months[0]?.opening_value).toBe('0.00');
  });
});

describe('o que o mês separa', () => {
  it('março: quinze mil de aporte e rendimento zero, apesar do movimento no meio', () => {
    expect(months[0]?.month).toBe('2024-03');
    expect(months[0]?.net_flow).toBe('15000.00');
    expect(months[0]?.income).toBe('0.00');
    expect(months[0]?.closing_value).toBe('15000.00');
  });

  it('a parcela de provento aparece destacada dentro do rendimento', () => {
    expect(months[0]?.payouts).toBe('50.00');
    expect(months[0]?.price_change).toBe('-50.00');

    expect(months[1]?.income).toBe('1000.00');
    expect(months[1]?.payouts).toBe('120.00');
    expect(months[1]?.price_change).toBe('880.00');
  });

  it('o mês com prejuízo devolve rendimento negativo, sem truncar em zero', () => {
    const queda = decomposeByMonth(
      buildQuotaSeries([
        {
          position_date: '2024-06-03',
          total_value: '10000.00',
          net_flow: '10000.00',
          payouts: '0.00',
        },
        {
          position_date: '2024-06-28',
          total_value: '9000.00',
          net_flow: '0.00',
          payouts: '0.00',
        },
      ]),
    );

    expect(queda[0]?.income).toBe('-1000.00');
    expect(queda[0]?.closing_value).toBe('9000.00');
  });

  it('o retorno do mês vem da cota, e não do saldo: o aporte não o contamina', () => {
    expect(months[0]?.return_pct).toBe('0.33');
    expect(months[1]?.return_pct).toBe('6.52');
  });

  it('série vazia não produz mês nenhum', () => {
    expect(decomposeByMonth([])).toEqual([]);
  });
});

describe('continuar de onde parou', () => {
  it('o mês parcial recebe o fechamento anterior como saldo inicial', () => {
    const series = buildQuotaSeries(twoMonths);
    const march = series.filter((day) => day.position_date.startsWith('2024-03'));
    const lastOfMarch = march.at(-1);

    const april = decomposeByMonth(
      series.filter((day) => day.position_date.startsWith('2024-04')),
      {
        ...(lastOfMarch === undefined
          ? {}
          : {
              previous: {
                total_value: lastOfMarch.total_value,
                quota_value: lastOfMarch.quota_value,
              },
            }),
      },
    );

    expect(april[0]?.opening_value).toBe('15000.00');
    expect(april[0]?.return_pct).toBe('6.52');
  });

  it('sem fechamento anterior o retorno do mês parcial é medido da primeira cota', () => {
    const only = decomposeByMonth(buildQuotaSeries(marchWithContribution));

    expect(only[0]?.return_pct).toBe('0.33');
  });
});

describe('total por ano', () => {
  it('soma aporte, rendimento e provento de cada ano, em ordem', () => {
    const totals = yearTotals(months);

    expect(totals).toEqual([
      { year: 2024, net_flow: '15500.00', income: '1000.00', payouts: '170.00' },
    ]);
  });

  it('sem mês não há ano', () => {
    expect(yearTotals([])).toEqual([]);
  });
});
