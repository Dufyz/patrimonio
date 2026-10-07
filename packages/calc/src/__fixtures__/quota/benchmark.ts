import type { FactorsByIndex } from '../../quota/benchmark.js';

/**
 * Séries de índice sintéticas, construídas a partir da convenção do Banco Central:
 * o fator diário do CDI é `(1 + DI_anual)^(1/252)`, guardado com doze casas. Um
 * CDI de 10,65% ao ano por 252 dias úteis tem de devolver 10,65% acumulado — essa
 * identidade é o que prova que o método é o mesmo da calculadora do Banco Central.
 *
 * A conferência contra a série real do Banco Central é do provedor, em E4: aqui o
 * que se prova é o método, não o dado.
 */
export const CDI_DAILY_10_65 = '1.000401675414';

/** 252 datas úteis de mentira, só para contar dias: segunda a sexta. */
export const businessDates = (from: string, count: number): readonly string[] => {
  const dates: string[] = [];
  const cursor = new Date(`${from}T00:00:00.000Z`);

  while (dates.length < count) {
    const weekday = cursor.getUTCDay();
    if (weekday !== 0 && weekday !== 6) dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return dates;
};

const flat = (dates: readonly string[], factor: string): ReadonlyMap<string, string> =>
  new Map(dates.map((date) => [date, factor]));

export const oneYearDates = businessDates('2024-01-02', 252);

/** CDI a 10,65% ao ano, dia a dia. */
export const cdiOneYear: FactorsByIndex = new Map([
  ['CDI', flat(oneYearDates, CDI_DAILY_10_65)],
]);

/** IPCA neutro: o acumulado do benchmark vem só do cupom contratado. */
export const neutralIpca: FactorsByIndex = new Map([
  ['IPCA', flat(oneYearDates, '1.000000000000')],
]);

export const blendDates = businessDates('2024-01-02', 40);

/**
 * CDI parado e IBOV com volatilidade: um índice que sobe 2% e cai 2% em dias
 * alternados termina abaixo de onde começou, e é nesse cenário que o
 * rebalanceamento muda o resultado.
 */
export const cdiAndIbov: FactorsByIndex = new Map([
  ['CDI', flat(blendDates, '1.000400000000')],
  [
    'IBOV',
    new Map(
      blendDates.map((date, index) => [
        date,
        index % 2 === 0 ? '1.020000000000' : '0.980000000000',
      ]),
    ),
  ],
]);

/** Série com buraco: o dia sem fator publicado não pode virar interpolação. */
export const cdiWithGap: FactorsByIndex = new Map([
  [
    'CDI',
    new Map(
      blendDates
        .filter((_, index) => index !== 5)
        .map((date) => [date, '1.000400000000']),
    ),
  ],
]);
