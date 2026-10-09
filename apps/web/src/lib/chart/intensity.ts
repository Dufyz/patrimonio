import { toNumber } from './scale.js';

/**
 * D-09 · A escala de intensidade da grade mês × ano.
 *
 * Uma escala só para a grade inteira, e não uma por ano: a graça da grade é
 * comparar 2023 com 2026, e isso só funciona se a mesma cor significar a mesma
 * coisa nas duas linhas.
 *
 * A escala é divergente e simétrica em torno de zero, com o mesmo alcance dos
 * dois lados. Sem a simetria, um mês de −1% em uma grade cujo melhor mês foi
 * +6% apareceria com a mesma intensidade de um mês de +1%, e a leitura rápida
 * — "este ano foi pior" — ficaria errada.
 */

export type IntensityScale = {
  /** O maior valor absoluto da grade; `0` quando não há nenhum. */
  readonly extent: number;
  /** De `-1` a `+1`. */
  readonly of: (value: string | null | undefined) => number;
};

export const intensityScale = (
  values: readonly (string | null | undefined)[],
): IntensityScale => {
  const numbers = values.map(toNumber).filter((value): value is number => value !== null);

  const extent = numbers.reduce(
    (largest, value) => Math.max(largest, Math.abs(value)),
    0,
  );

  return {
    extent,
    of: (value) => {
      const parsed = toNumber(value);
      if (parsed === null || extent === 0) return 0;
      return Math.max(-1, Math.min(1, parsed / extent));
    },
  };
};

/**
 * As marcas da legenda: do pior ao melhor, passando por zero. Cinco degraus,
 * como a prancha 08 mostra.
 */
export const legendSteps = (scale: IntensityScale): readonly number[] =>
  scale.extent === 0 ? [0] : [-1, -0.5, 0, 0.5, 1];
