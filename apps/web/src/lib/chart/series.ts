import type { DateOnly } from '@patrimonio/domain';

import type { Scale } from './scale.js';
import { toNumber } from './scale.js';

/**
 * D-08 · O que uma série é e como ela vira caminho.
 *
 * A regra que decide quase tudo aqui: **buraco aparece como buraco**. Um dia
 * sem fechamento não é um dia de valor zero, e não é uma reta entre o dia
 * anterior e o seguinte. Ligar os dois pontos é a mentira mais fácil de contar
 * em um gráfico, porque ela fica bonita.
 */

export type Point = {
  readonly date: DateOnly;
  readonly value: string | null;
};

/** Faixa de área empilhada: o par já vem resolvido pela `api`. */
export type Band = {
  readonly date: DateOnly;
  readonly from: string | null;
  readonly to: string | null;
};

export type SeriesKind = 'line' | 'area' | 'bar';

export type Series = {
  readonly id: string;
  readonly label: string;
  /** Cor já resolvida em `var(--...)` por `lib/tokens.ts`. */
  readonly color: string;
  readonly points: readonly Point[];
  /** Benchmark é tracejado, para não disputar com a série da carteira. */
  readonly dashed?: boolean | undefined;
};

/**
 * Quebra a série nos buracos. Cada trecho vira um caminho próprio, então o
 * desenho simplesmente não existe onde não há dado.
 */
export const splitSegments = (
  points: readonly Point[],
): readonly (readonly { readonly index: number; readonly value: number }[])[] => {
  const segments: { index: number; value: number }[][] = [];
  let current: { index: number; value: number }[] = [];

  points.forEach((point, index) => {
    const value = toNumber(point.value);
    if (value === null) {
      if (current.length > 0) segments.push(current);
      current = [];
      return;
    }
    current.push({ index, value });
  });

  if (current.length > 0) segments.push(current);
  return segments;
};

export const valuesOf = (series: readonly Series[]): readonly number[] =>
  series.flatMap((entry) =>
    entry.points
      .map((point) => toNumber(point.value))
      .filter((value): value is number => value !== null),
  );

/**
 * Os valores de marcas e referências, para o domínio do eixo contá-los. O que
 * não é número fica de fora: uma marca sem preço é uma marca que não se
 * desenha, não uma marca no zero.
 */
export const markerValues = (
  marks: readonly { readonly value: string | null }[],
): readonly number[] =>
  marks.flatMap((mark) => {
    const value = toNumber(mark.value);
    return value === null ? [] : [value];
  });

export const bandValuesOf = (bands: readonly Band[]): readonly number[] =>
  bands.flatMap((band) =>
    [toNumber(band.from), toNumber(band.to)].filter(
      (value): value is number => value !== null,
    ),
  );

export const linePath = (
  segment: readonly { readonly index: number; readonly value: number }[],
  x: Scale,
  y: Scale,
): string =>
  segment
    .map(
      (point, position) =>
        `${position === 0 ? 'M' : 'L'}${x(point.index).toFixed(2)},${y(point.value).toFixed(2)}`,
    )
    .join(' ');

/**
 * A faixa entre dois valores. Um trecho só: a faixa também quebra no buraco,
 * pelo mesmo motivo da linha.
 */
export const bandSegments = (
  bands: readonly Band[],
): readonly (readonly {
  readonly index: number;
  readonly from: number;
  readonly to: number;
}[])[] => {
  const segments: { index: number; from: number; to: number }[][] = [];
  let current: { index: number; from: number; to: number }[] = [];

  bands.forEach((band, index) => {
    const from = toNumber(band.from);
    const to = toNumber(band.to);
    if (from === null || to === null) {
      if (current.length > 0) segments.push(current);
      current = [];
      return;
    }
    current.push({ index, from, to });
  });

  if (current.length > 0) segments.push(current);
  return segments;
};

export const bandPath = (
  segment: readonly {
    readonly index: number;
    readonly from: number;
    readonly to: number;
  }[],
  x: Scale,
  y: Scale,
): string => {
  const top = segment.map(
    (point, position) =>
      `${position === 0 ? 'M' : 'L'}${x(point.index).toFixed(2)},${y(point.to).toFixed(2)}`,
  );
  const bottom = [...segment]
    .reverse()
    .map((point) => `L${x(point.index).toFixed(2)},${y(point.from).toFixed(2)}`);

  return [...top, ...bottom, 'Z'].join(' ');
};

/**
 * Dez anos de série diária são cerca de 2.500 pontos por série, e quatro
 * séries passam de dez mil. Desenhar um ponto por pixel dá o mesmo traço e
 * mantém a interação viva: o olho não distingue dois pontos na mesma coluna de
 * pixels, e o navegador distingue — ele os desenha.
 *
 * Os extremos de cada balde sobrevivem, então um pico de um dia não some: é
 * justamente o dia que alguém quer ver.
 */
export const downsample = (
  points: readonly Point[],
  maxPoints: number,
): readonly Point[] => {
  if (maxPoints <= 2 || points.length <= maxPoints) return points;

  const bucketSize = points.length / maxPoints;
  const out: Point[] = [];

  for (let bucket = 0; bucket < maxPoints; bucket += 1) {
    const start = Math.floor(bucket * bucketSize);
    const end = Math.min(points.length, Math.floor((bucket + 1) * bucketSize));
    const slice = points.slice(start, end);
    if (slice.length === 0) continue;

    let lowest = slice[0] as Point;
    let highest = slice[0] as Point;
    let hasHole = false;

    for (const point of slice) {
      const value = toNumber(point.value);
      if (value === null) {
        hasHole = true;
        continue;
      }
      const low = toNumber(lowest.value);
      const high = toNumber(highest.value);
      if (low === null || value < low) lowest = point;
      if (high === null || value > high) highest = point;
    }

    // Um buraco dentro do balde continua sendo um buraco depois de reduzir.
    if (hasHole) {
      out.push({ date: slice[0]?.date ?? lowest.date, value: null });
      continue;
    }

    const first = lowest.date <= highest.date ? lowest : highest;
    const second = first === lowest ? highest : lowest;
    out.push(first);
    if (second !== first) out.push(second);
  }

  return out;
};

/** O índice mais próximo do cursor, para a dica seguir o mouse. */
export const nearestIndex = (pointerX: number, count: number, x: Scale): number => {
  if (count === 0) return -1;

  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < count; index += 1) {
    const distance = Math.abs(x(index) - pointerX);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  }
  return best;
};

/**
 * De que lado a dica aparece. Perto da borda direita ela troca de lado, em vez
 * de sair da tela — e a troca acontece com folga, para a dica não piscar de um
 * lado para o outro quando o cursor está exatamente no limite.
 */
export const tooltipSide = (
  pointerX: number,
  chartWidth: number,
  tooltipWidth: number,
): 'right' | 'left' => (pointerX + tooltipWidth + 16 > chartWidth ? 'left' : 'right');
