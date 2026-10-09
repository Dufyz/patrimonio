import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import { twoMonths } from '../__fixtures__/quota/series.js';
import { buildQuotaSeries } from './series.js';
import type { DailyTotals } from './series.js';
import {
  allWindows,
  annualizedPct,
  basePoint,
  resolveWindow,
  returnBetween,
  returnPct,
  windowStart,
} from './windows.js';

const series = buildQuotaSeries(twoMonths);

/**
 * Monta uma série a partir do retorno de mercado do dia e do fluxo do dia: o
 * fluxo entra no começo do dia e rende junto. É a forma de comparar dois
 * cronogramas de aporte sobre a mesma trajetória de mercado.
 */
const seriesFrom = (
  returns: readonly string[],
  flows: readonly string[],
): readonly DailyTotals[] => {
  const days: DailyTotals[] = [];
  let total = new Decimal(0);

  returns.forEach((rate, index) => {
    const flow = new Decimal(flows[index] ?? '0');
    total = total.plus(flow).times(new Decimal(1).plus(new Decimal(rate)));

    days.push({
      position_date: `2024-07-0${index + 1}`,
      total_value: total.toDecimalPlaces(2).toFixed(2),
      net_flow: flow.toDecimalPlaces(2).toFixed(2),
      payouts: '0.00',
    });

    total = new Decimal(total.toDecimalPlaces(2).toFixed(2));
  });

  return days;
};

describe('data-base de cada janela', () => {
  it('o mês parte do fechamento do mês anterior, não do dia 1', () => {
    expect(windowStart('2024-04-30', 'month')).toBe('2024-03-31');
    expect(windowStart('2024-01-15', 'month')).toBe('2023-12-31');
  });

  it('o ano parte do último dia do ano anterior', () => {
    expect(windowStart('2024-04-30', 'ytd')).toBe('2023-12-31');
  });

  it('as janelas móveis contam mês, e 31 de março menos um mês é 29 de fevereiro', () => {
    expect(windowStart('2024-04-30', '3m')).toBe('2024-01-30');
    expect(windowStart('2024-04-30', '12m')).toBe('2023-04-30');
    expect(windowStart('2024-04-30', '24m')).toBe('2022-04-30');
    expect(windowStart('2024-03-31', 'month')).toBe('2024-02-29');
  });

  it('desde o início não tem data-base: a base é a primeira linha da série', () => {
    expect(windowStart('2024-04-30', 'inception')).toBeNull();
  });
});

describe('retorno por janela', () => {
  it('o mês sai de duas linhas: o fechamento de março e o de abril', () => {
    const month = resolveWindow(series, 'month');

    expect(month?.from.position_date).toBe('2024-03-08');
    expect(month?.to.position_date).toBe('2024-04-30');
    expect(month?.return_pct).toBe('6.52');
  });

  it('desde o início mede contra a primeira cota da série', () => {
    const inception = resolveWindow(series, 'inception');

    expect(inception?.from.position_date).toBe('2024-03-01');
    expect(inception?.return_pct).toBe('6.87');
  });

  it('janela maior que o histórico devolve traço, nunca um número extrapolado', () => {
    expect(resolveWindow(series, 'ytd')).toBeNull();
    expect(resolveWindow(series, '12m')).toBeNull();
    expect(resolveWindow(series, '24m')).toBeNull();
  });

  it('o retorno não é afetado por aporte ou resgate no meio do período', () => {
    // A mesma trajetória de mercado, dois cronogramas de aporte diferentes. O
    // patrimônio final muda; o retorno da cota é o mesmo. É a razão de a cota
    // existir, e o número que a tela de Desempenho mostra.
    const returns = ['0.004', '-0.012', '0.009', '0.002', '0.015'];

    const semAporte = buildQuotaSeries(
      seriesFrom(returns, ['10000', '0', '0', '0', '0']),
    );
    const comAporte = buildQuotaSeries(
      seriesFrom(returns, ['10000', '7000', '0', '-3000', '2500']),
    );

    expect(semAporte.at(-1)?.total_value).not.toBe(comAporte.at(-1)?.total_value);
    expect(resolveWindow(comAporte, 'inception')?.return_pct).toBe(
      resolveWindow(semAporte, 'inception')?.return_pct,
    );
  });

  it('todas as janelas saem de uma chamada, com traço onde não há histórico', () => {
    const windows = allWindows(series);

    expect(windows.month?.return_pct).toBe('6.52');
    expect(windows.ytd).toBeNull();
    expect(windows.inception?.return_pct).toBe('6.87');
  });
});

describe('duas linhas e nada mais', () => {
  it('o retorno entre duas linhas é o mesmo que a janela resolvida na série', () => {
    const month = resolveWindow(series, 'month');

    const direct = returnBetween(
      'month',
      { position_date: '2024-03-08', quota_value: '1.003311258278' },
      { position_date: '2024-04-30', quota_value: '1.068716992204' },
    );

    expect(direct?.return_pct).toBe(month?.return_pct);
  });

  it('linha faltando de um dos lados devolve nulo', () => {
    expect(returnBetween('month', null, series.at(-1) ?? null)).toBeNull();
    expect(returnBetween('month', series[0] ?? null, null)).toBeNull();
  });

  it('a linha-base é a última anterior ou igual à data pedida', () => {
    expect(basePoint(series, '2024-03-31')?.position_date).toBe('2024-03-08');
    expect(basePoint(series, '2024-02-01')).toBeNull();
  });

  it('série vazia não tem janela nenhuma', () => {
    expect(resolveWindow([], 'month')).toBeNull();
    expect(resolveWindow([], 'inception')).toBeNull();
  });

  it('série de um dia só não tem retorno desde o início', () => {
    expect(resolveWindow(series.slice(0, 1), 'inception')).toBeNull();
  });

  it('referência fora da série devolve nulo em vez do último dia', () => {
    expect(resolveWindow(series, 'month', '2024-01-01')).toBeNull();
  });
});

describe('anualização', () => {
  it('abaixo de um ano não se anualiza: extrapolar meses para o ano é invenção', () => {
    expect(resolveWindow(series, 'month')?.annualized_pct).toBeNull();
    expect(annualizedPct('1', '1.05', 200)).toBeNull();
  });

  it('a partir de um ano a anualização é composta, não linear', () => {
    // 21,55% em dois anos é 10% ao ano composto, não 10,775%.
    expect(annualizedPct('1', '1.21', 730)).toBe('10.00');
  });

  it('cota zero não divide: devolve zero em vez de infinito', () => {
    expect(returnPct('0', '1.05')).toBe('0.00');
    expect(annualizedPct('0', '1.05', 400)).toBeNull();
  });
});
