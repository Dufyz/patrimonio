import { describe, expect, it } from 'vitest';

import {
  blendDates,
  cdiAndIbov,
  cdiOneYear,
  cdiWithGap,
  neutralIpca,
  oneYearDates,
} from '../__fixtures__/quota/benchmark.js';
import { benchmarkReturn, benchmarkSeries, differencePp } from './benchmark.js';

describe('índice simples', () => {
  it('o CDI acumulado em doze meses é o produto dos fatores diários', () => {
    const result = benchmarkReturn({
      definition: { kind: 'index', index: 'CDI' },
      factors: cdiOneYear,
      dates: oneYearDates,
    });

    // 252 fatores diários de um CDI de 10,65% ao ano devolvem 10,65%: é a
    // convenção do Banco Central, e é o que prova que o método é o mesmo.
    expect(result.days).toBe(252);
    expect(result.return_pct).toBe('10.65');
  });

  it('dia sem fator publicado é dia sem variação, não dia interpolado', () => {
    const comBuraco = benchmarkReturn({
      definition: { kind: 'index', index: 'CDI' },
      factors: cdiWithGap,
      dates: blendDates,
    });
    const completo = benchmarkReturn({
      definition: { kind: 'index', index: 'CDI' },
      factors: new Map([
        ['CDI', new Map(blendDates.map((date) => [date, '1.000400000000'])) as ReadonlyMap<string, string>],
      ]),
      dates: blendDates,
    });

    // Um dia a menos de fator é um dia a menos de rendimento — e não o fator do
    // dia anterior repetido, que inventaria variação.
    expect(Number(comBuraco.factor)).toBeLessThan(Number(completo.factor));
    expect(comBuraco.days).toBe(completo.days);
  });

  it('índice inexistente não quebra: o benchmark fica parado em 1', () => {
    const result = benchmarkReturn({
      definition: { kind: 'index', index: 'NAO_EXISTE' },
      factors: cdiOneYear,
      dates: oneYearDates,
    });

    expect(result.factor).toBe('1.000000000000');
    expect(result.return_pct).toBe('0.00');
  });

  it('período vazio devolve fator 1', () => {
    const result = benchmarkReturn({
      definition: { kind: 'index', index: 'CDI' },
      factors: cdiOneYear,
      dates: [],
    });

    expect(result.factor).toBe('1.000000000000');
    expect(result.days).toBe(0);
  });
});

describe('índice mais taxa', () => {
  it('IPCA + 6% ao ano é composto por dia útil, não linear', () => {
    const ano = benchmarkReturn({
      definition: { kind: 'index_plus_rate', index: 'IPCA', rate: '6' },
      factors: neutralIpca,
      dates: oneYearDates,
    });

    expect(ano.return_pct).toBe('6.00');

    const meio = benchmarkReturn({
      definition: { kind: 'index_plus_rate', index: 'IPCA', rate: '6' },
      factors: neutralIpca,
      dates: oneYearDates.slice(0, 126),
    });

    // Linear daria 3,00%. Composto dá 2,96%.
    expect(meio.return_pct).toBe('2.96');
  });

  it('o cupom compõe sobre o índice, não ao lado dele', () => {
    const comIndice = benchmarkReturn({
      definition: { kind: 'index_plus_rate', index: 'CDI', rate: '6' },
      factors: cdiOneYear,
      dates: oneYearDates,
    });

    // 10,65% e 6% compostos dão mais do que a soma simples de 16,65%.
    expect(Number(comIndice.return_pct)).toBeGreaterThan(16.65);
  });
});

describe('benchmark composto', () => {
  const definition = {
    kind: 'blend' as const,
    parts: [
      { index: 'CDI', weight: '0.5' },
      { index: 'IBOV', weight: '0.5' },
    ],
  };

  it('o peso é normalizado: 0,5 e 50 dão o mesmo resultado', () => {
    const comFracao = benchmarkReturn({
      definition,
      rebalance: 'daily',
      factors: cdiAndIbov,
      dates: blendDates,
    });
    const comPercentual = benchmarkReturn({
      definition: {
        kind: 'blend',
        parts: [
          { index: 'CDI', weight: '50' },
          { index: 'IBOV', weight: '50' },
        ],
      },
      rebalance: 'daily',
      factors: cdiAndIbov,
      dates: blendDates,
    });

    expect(comPercentual.factor).toBe(comFracao.factor);
  });

  it('rebalancear na periodicidade declarada muda o resultado', () => {
    const resultados = (['daily', 'monthly', 'never'] as const).map(
      (rebalance) =>
        benchmarkReturn({ definition, rebalance, factors: cdiAndIbov, dates: blendDates })
          .factor,
    );

    expect(new Set(resultados).size).toBe(3);
  });

  it('sem rebalanceamento a parte que sobe passa a pesar mais', () => {
    const series = benchmarkSeries({
      definition,
      rebalance: 'never',
      factors: cdiAndIbov,
      dates: blendDates.slice(0, 2),
    });

    // Dia 1 o IBOV sobe 2% e o CDI 0,04%: a carteira sobe ~1,02%. Dia 2 o IBOV
    // cai 2% sobre uma base maior, então o conjunto não volta ao ponto de partida.
    expect(Number(series[0]?.accumulated)).toBeGreaterThan(1);
    expect(Number(series[1]?.accumulated)).toBeLessThan(
      Number(series[0]?.accumulated),
    );
  });

  it('peso somando zero não divide por zero', () => {
    const result = benchmarkReturn({
      definition: {
        kind: 'blend',
        parts: [
          { index: 'CDI', weight: '0' },
          { index: 'IBOV', weight: '0' },
        ],
      },
      factors: cdiAndIbov,
      dates: blendDates,
    });

    expect(result.factor).toBe('0.000000000000');
  });

  it('a série devolve uma linha por data, com o fator do dia e o acumulado', () => {
    const series = benchmarkSeries({
      definition,
      rebalance: 'daily',
      factors: cdiAndIbov,
      dates: blendDates,
    });

    expect(series).toHaveLength(blendDates.length);
    expect(series[0]?.date).toBe(blendDates[0]);
    // Metade de +2% e metade de +0,04% é +1,02% no dia.
    expect(series[0]?.daily_factor).toBe('1.010200000000');
  });
});

describe('diferença contra a carteira', () => {
  it('sai em pontos percentuais, com sinal', () => {
    expect(differencePp('12.40', '10.65')).toBe('1.75');
    expect(differencePp('8.10', '10.65')).toBe('-2.55');
    expect(differencePp('10.65', '10.65')).toBe('0.00');
  });
});
