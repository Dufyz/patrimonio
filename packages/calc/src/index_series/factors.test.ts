import { describe, expect, it } from 'vitest';

import {
  accumulate,
  dailyFactorsFrom,
  factorFromDailyPct,
  factorFromMonthlyPct,
} from './factors.js';
import type { IndexObservation } from './factors.js';

/** Os dias úteis de março de 2024: 20 dias, com 29/03 (Sexta-feira Santa) fora. */
const MARCO_2024 = [
  '2024-03-01',
  '2024-03-04',
  '2024-03-05',
  '2024-03-06',
  '2024-03-07',
  '2024-03-08',
  '2024-03-11',
  '2024-03-12',
  '2024-03-13',
  '2024-03-14',
  '2024-03-15',
  '2024-03-18',
  '2024-03-19',
  '2024-03-20',
  '2024-03-21',
  '2024-03-22',
  '2024-03-25',
  '2024-03-26',
  '2024-03-27',
  '2024-03-28',
];

describe('taxa diária publicada em percentual', () => {
  it('a taxa do dia do CDI vira 1 mais a taxa, sem conversão de prazo', () => {
    // 0,041957% ao dia é o CDI com a Selic a 10,65% ao ano.
    expect(factorFromDailyPct('0.041957')).toBe('1.000419570000');
  });

  it('taxa zero é fator um, e não ausência de linha', () => {
    expect(factorFromDailyPct('0')).toBe('1.000000000000');
  });

  it('o acumulado de uma série é o produto dos fatores', () => {
    // 21 dias úteis a 0,041957% ao dia: 1,0088... — a conta que a calculadora
    // do Banco Central faz, que é produto e não soma.
    const factors = Array.from({ length: 21 }, () => factorFromDailyPct('0.041957'));

    expect(accumulate(factors)).toBe('1.008848036607');
  });

  it('doze meses de CDI acumulam composto, não linear', () => {
    // 252 dias úteis a 0,041957% ao dia dão ~11,15% — acima dos 10,57% que a
    // soma simples daria. A diferença é o que o produto captura.
    const ano = accumulate(
      Array.from({ length: 252 }, () => factorFromDailyPct('0.041957')),
    );

    expect(ano).toBe('1.111498900580');
    expect(Number(ano) - 1).toBeGreaterThan((0.041957 * 252) / 100);
  });
});

describe('IPCA do mês distribuído pró-rata dia útil', () => {
  it('o fator do dia é a raiz du do fator do mês', () => {
    // 0,16% em 20 dias úteis.
    const diario = factorFromMonthlyPct('0.16', 20);

    expect(diario).toBe('1.000079939263');
  });

  it('o produto dos dias úteis reconstrói o mês', () => {
    const diario = factorFromMonthlyPct('0.16', 20);
    const mes = accumulate(Array.from({ length: 20 }, () => diario));

    // Até a décima casa: o resíduo é do truncamento em doze casas do fator
    // diário, e é irrelevante na escala de centavos do patrimônio.
    expect(Number(mes)).toBeCloseTo(1.0016, 10);
  });

  it('IPCA negativo é deflação, e deflação reduz o fator', () => {
    expect(Number(factorFromMonthlyPct('-0.08', 21))).toBeLessThan(1);
  });

  it('mês sem dia útil não divide por zero', () => {
    expect(factorFromMonthlyPct('0.16', 0)).toBe('1.000000000000');
  });

  it('cada dia útil do mês recebe uma linha, e só os dias úteis', () => {
    const rows = dailyFactorsFrom(
      [{ reference_date: '2024-03-01', unit: 'monthly_pct', raw_value: '0.16' }],
      MARCO_2024,
    );

    expect(rows).toHaveLength(20);
    expect(rows.map((row) => row.quote_date)).toEqual(MARCO_2024);
    // Sexta-feira Santa não está no calendário, então não tem linha.
    expect(rows.some((row) => row.quote_date === '2024-03-29')).toBe(false);
  });
});

describe('buraco na série é buraco', () => {
  it('dia sem publicação não gera linha, em vez de repetir o valor anterior', () => {
    const observations: IndexObservation[] = [
      { reference_date: '2024-03-01', unit: 'daily_pct', raw_value: '0.041957' },
      // 04/03 não foi publicado.
      { reference_date: '2024-03-05', unit: 'daily_pct', raw_value: '0.041957' },
    ];

    const rows = dailyFactorsFrom(observations, MARCO_2024);

    expect(rows.map((row) => row.quote_date)).toEqual(['2024-03-01', '2024-03-05']);
  });

  it('publicação em dia não útil é descartada', () => {
    const rows = dailyFactorsFrom(
      [{ reference_date: '2024-03-02', unit: 'daily_pct', raw_value: '0.041957' }],
      MARCO_2024,
    );

    expect(rows).toEqual([]);
  });

  it('a mesma data publicada duas vezes não duplica linha', () => {
    const rows = dailyFactorsFrom(
      [
        { reference_date: '2024-03-01', unit: 'daily_pct', raw_value: '0.041957' },
        { reference_date: '2024-03-01', unit: 'daily_pct', raw_value: '0.041957' },
      ],
      MARCO_2024,
    );

    expect(rows).toHaveLength(1);
  });

  it('a série sai em ordem de data, qualquer que seja a ordem da fonte', () => {
    const rows = dailyFactorsFrom(
      [
        { reference_date: '2024-03-05', unit: 'daily_pct', raw_value: '0.04' },
        { reference_date: '2024-03-01', unit: 'daily_pct', raw_value: '0.04' },
        { reference_date: '2024-03-04', unit: 'daily_pct', raw_value: '0.04' },
      ],
      MARCO_2024,
    );

    expect(rows.map((row) => row.quote_date)).toEqual([
      '2024-03-01',
      '2024-03-04',
      '2024-03-05',
    ]);
  });
});

describe('índice em pontos', () => {
  it('o fator do dia é a razão entre dois fechamentos', () => {
    const rows = dailyFactorsFrom(
      [
        { reference_date: '2024-03-01', unit: 'index_points', raw_value: '130000' },
        { reference_date: '2024-03-04', unit: 'index_points', raw_value: '131300' },
      ],
      MARCO_2024,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.quote_date).toBe('2024-03-04');
    expect(rows[0]?.daily_factor).toBe('1.010000000000');
  });

  it('o primeiro ponto da série não tem fator, porque não tem anterior', () => {
    const rows = dailyFactorsFrom(
      [{ reference_date: '2024-03-01', unit: 'index_points', raw_value: '130000' }],
      MARCO_2024,
    );

    expect(rows).toEqual([]);
  });

  it('pontuação zero não produz divisão por zero', () => {
    const rows = dailyFactorsFrom(
      [
        { reference_date: '2024-03-01', unit: 'index_points', raw_value: '0' },
        { reference_date: '2024-03-04', unit: 'index_points', raw_value: '131300' },
      ],
      MARCO_2024,
    );

    expect(rows).toEqual([]);
  });
});
