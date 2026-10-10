import { describe, expect, it } from 'vitest';

import {
  shortDates,
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
      dates: shortDates,
    });
    const completo = benchmarkReturn({
      definition: { kind: 'index', index: 'CDI' },
      factors: new Map([
        [
          'CDI',
          new Map(shortDates.map((date) => [date, '1.000400000000'])) as ReadonlyMap<
            string,
            string
          >,
        ],
      ]),
      dates: shortDates,
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

describe('percentual do índice', () => {
  it('110% do CDI rende 10% a mais que o CDI em fator, não em taxa anual', () => {
    const cdi = benchmarkReturn({
      definition: { kind: 'index', index: 'CDI' },
      factors: cdiOneYear,
      dates: oneYearDates,
    });
    const cento = benchmarkReturn({
      definition: { kind: 'percent_of_index', index: 'CDI', percent: '100' },
      factors: cdiOneYear,
      dates: oneYearDates,
    });
    const acima = benchmarkReturn({
      definition: { kind: 'percent_of_index', index: 'CDI', percent: '110' },
      factors: cdiOneYear,
      dates: oneYearDates,
    });

    expect(cento.return_pct).toBe(cdi.return_pct);
    expect(Number(acima.return_pct)).toBeGreaterThan(Number(cdi.return_pct));
  });

  it('50% do CDI rende menos que o CDI', () => {
    const metade = benchmarkReturn({
      definition: { kind: 'percent_of_index', index: 'CDI', percent: '50' },
      factors: cdiOneYear,
      dates: oneYearDates,
    });

    expect(Number(metade.return_pct)).toBeLessThan(10.65);
    expect(Number(metade.return_pct)).toBeGreaterThan(5);
  });

  it('a série devolve uma linha por data, com o fator do dia e o acumulado', () => {
    const series = benchmarkSeries({
      definition: { kind: 'percent_of_index', index: 'CDI', percent: '110' },
      factors: cdiWithGap,
      dates: shortDates,
    });

    expect(series).toHaveLength(shortDates.length);
    expect(series[0]?.date).toBe(shortDates[0]);
  });
});

describe('diferença contra a carteira', () => {
  it('sai em pontos percentuais, com sinal', () => {
    expect(differencePp('12.40', '10.65')).toBe('1.75');
    expect(differencePp('8.10', '10.65')).toBe('-2.55');
    expect(differencePp('10.65', '10.65')).toBe('0.00');
  });
});
