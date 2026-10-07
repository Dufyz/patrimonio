import { describe, expect, it } from 'vitest';

import {
  fullRedemptionThenContribution,
  marchWithContribution,
  staleDay,
} from '../__fixtures__/quota/series.js';
import { buildQuotaSeries, seedFrom, totalFromQuota } from './series.js';

describe('a cota separa aporte de rentabilidade', () => {
  const series = buildQuotaSeries(marchWithContribution);

  it('o primeiro dia nasce com o valor de cota inicial e nenhum rendimento', () => {
    expect(series[0]?.quota_value).toBe('1.000000000000');
    expect(series[0]?.quota_count).toBe('10000.000000000000');
    expect(series[0]?.income).toBe('0.00');
  });

  it('dia sem fluxo muda o valor da cota e não a quantidade', () => {
    expect(series[1]?.quota_value).toBe('1.010000000000');
    expect(series[1]?.quota_count).toBe(series[0]?.quota_count);
    expect(series[1]?.income).toBe('100.00');
  });

  it('aporte no meio do mês sobe a quantidade de cotas e não o valor delas', () => {
    expect(series[2]?.net_flow).toBe('5000.00');
    expect(series[2]?.quota_value).toBe('1.010000000000');
    expect(series[2]?.quota_count).toBe('14950.495049504950');
    // O aporte não é rendimento, e o rendimento do dia é zero porque o mercado
    // não andou. É esta linha que impede o aporte de parecer rentabilidade.
    expect(series[2]?.income).toBe('0.00');
  });

  it('o mercado do dia do aporte continua aparecendo no valor da cota', () => {
    const withMarket = buildQuotaSeries([
      ...marchWithContribution.slice(0, 2),
      {
        position_date: '2024-03-05',
        total_value: '15150.00',
        net_flow: '5000.00',
        payouts: '0.00',
      },
    ]);

    expect(withMarket[2]?.income).toBe('50.00');
    expect(withMarket[2]?.quota_value).not.toBe('1.010000000000');
  });

  it('provento entra como rendimento e fica destacado', () => {
    expect(series[4]?.payouts).toBe('50.00');
    expect(series[4]?.income).toBe('50.00');
  });

  it('o mês com queda devolve rendimento negativo, sem truncar em zero', () => {
    expect(series[5]?.income).toBe('-301.00');
  });

  it('o aporte acumulado acompanha só o dinheiro que entrou', () => {
    expect(series.at(-1)?.cumulative_contributions).toBe('15000.00');
  });
});

describe('a invariante da cota', () => {
  it('quota_value × quota_count é o patrimônio do dia, em todo dia da série', () => {
    for (const day of buildQuotaSeries(marchWithContribution)) {
      expect(totalFromQuota(day)).toBe(day.total_value);
    }
  });

  it('o valor da cota nunca é zero nem negativo: o banco recusaria', () => {
    for (const day of buildQuotaSeries(fullRedemptionThenContribution)) {
      expect(Number(day.quota_value)).toBeGreaterThan(0);
      expect(Number(day.quota_count)).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('casos limite da série', () => {
  const series = buildQuotaSeries(fullRedemptionThenContribution);

  it('resgate total zera a quantidade e preserva o valor da cota', () => {
    expect(series[2]?.quota_count).toBe('0.000000000000');
    expect(series[2]?.quota_value).toBe('1.050000000000');
    expect(series[2]?.total_value).toBe('0.00');
  });

  it('novo aporte depois do resgate total continua a série em vez de reiniciar', () => {
    expect(series[4]?.quota_value).toBe('1.050000000000');
    expect(series[4]?.quota_count).toBe('2000.000000000000');
    expect(series[4]?.income).toBe('0.00');
  });

  it('carteira zerada por vários dias não perde o valor da cota', () => {
    expect(series[3]?.quota_value).toBe('1.050000000000');
    expect(series[3]?.quota_count).toBe('0.000000000000');
  });

  it('dia sem preço novo repete o último e não inventa variação', () => {
    const repeated = buildQuotaSeries(staleDay);

    expect(repeated[2]?.total_value).toBe(repeated[1]?.total_value);
    expect(repeated[2]?.income).toBe('0.00');
    expect(repeated[2]?.quota_value).toBe(repeated[1]?.quota_value);
    expect(repeated[2]?.quota_count).toBe(repeated[1]?.quota_count);
  });

  it('série vazia devolve série vazia', () => {
    expect(buildQuotaSeries([])).toEqual([]);
  });
});

describe('continuar a série de onde ela parou', () => {
  it('reconstruir um pedaço produz a mesma série que reconstruir tudo', () => {
    const whole = buildQuotaSeries(marchWithContribution);

    const head = buildQuotaSeries(marchWithContribution.slice(0, 3));
    const lastOfHead = head.at(-1);
    const tail = buildQuotaSeries(marchWithContribution.slice(3), {
      ...(lastOfHead === undefined ? {} : { previous: seedFrom(lastOfHead) }),
    });

    expect([...head, ...tail]).toEqual(whole);
  });

  it('o valor de cota inicial é parâmetro, e o retorno não depende dele', () => {
    const atHundred = buildQuotaSeries(marchWithContribution, {
      initial_quota_value: '100',
    });

    expect(atHundred[0]?.quota_value).toBe('100.000000000000');
    expect(atHundred[0]?.quota_count).toBe('100.000000000000');

    const whole = buildQuotaSeries(marchWithContribution);
    const ratio = (days: readonly { readonly quota_value: string }[]): number =>
      Number(days.at(-1)?.quota_value) / Number(days[0]?.quota_value);

    expect(ratio(atHundred)).toBeCloseTo(ratio(whole), 10);
  });
});
