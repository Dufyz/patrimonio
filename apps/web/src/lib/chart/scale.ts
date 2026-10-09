/**
 * D-07, D-08 e D-09 · Geometria.
 *
 * Aqui, e só aqui, um valor vira `number`. A regra do projeto é que o `web` não
 * faz aritmética com dinheiro — e ela continua valendo: o que estas funções
 * produzem são coordenadas em pixel, nunca um número que volta para a tela como
 * dinheiro. Todo valor exibido — na dica, na célula, no rótulo — é formatado da
 * string original que veio da `api`.
 */

import { parseDecimal } from '../decimal.js';

/**
 * A fronteira explícita entre string e número. Devolve `null` para valor
 * ausente ou ilegível, e quem chama trata o buraco como buraco em vez de
 * desenhar um zero.
 */
export const toNumber = (value: string | null | undefined): number | null => {
  if (value === null || value === undefined) return null;
  if (parseDecimal(value) === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/** Razão para percentual de exibição: `"0.353"` → `35.3`. */
export const toPercentNumber = (value: string | null | undefined): number | null => {
  const parsed = toNumber(value);
  return parsed === null ? null : parsed * 100;
};

export type Scale = (value: number) => number;

export const linearScale = (
  domain: readonly [number, number],
  range: readonly [number, number],
): Scale => {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0;
  // Domínio degenerado — uma série constante — desenha no meio da faixa em vez
  // de dividir por zero e sumir do gráfico.
  if (span === 0) return () => (r0 + r1) / 2;
  return (value) => r0 + ((value - d0) / span) * (r1 - r0);
};

const STEPS = [1, 2, 2.5, 5, 10] as const;

/**
 * Marcas de eixo em números redondos. Um eixo que vai de 0 a 318.904 precisa
 * mostrar 100k, 200k e 300k — e não 106.301, 212.602 e 318.904, que é o que
 * dividir o intervalo em partes iguais produz.
 */
export const niceTicks = (min: number, max: number, count = 5): readonly number[] => {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (min === max) return [min];

  const rough = (max - min) / Math.max(1, count);
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step =
    (STEPS.find((candidate) => candidate * magnitude >= rough) ?? 10) * magnitude;

  const first = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  for (let value = first; value <= max + step / 1000; value += step) {
    // Soma repetida de ponto flutuante gera 0.30000000000000004; arredondar
    // pela casa do passo devolve o número redondo que o eixo promete.
    ticks.push(Number(value.toFixed(12)));
  }
  return ticks;
};

/**
 * O domínio vertical. Área empilhada começa em zero — a prancha 18 é explícita:
 * "gráficos não mentem nos limites" —, e linha de retorno pode começar abaixo
 * de zero porque prejuízo existe.
 */
export const domainOf = (
  values: readonly number[],
  options: { readonly fromZero?: boolean } = {},
): readonly [number, number] => {
  if (values.length === 0) return [0, 1];

  const min = Math.min(...values);
  const max = Math.max(...values);
  const low = options.fromZero === true ? Math.min(0, min) : min;
  const high = options.fromZero === true ? Math.max(0, max) : max;

  if (low === high) return [low === 0 ? 0 : low * 0.9, high === 0 ? 1 : high * 1.1];

  const padding = (high - low) * 0.08;
  return [options.fromZero === true ? low : low - padding, high + padding];
};

/** Posições de barra em um eixo categórico, com folga entre elas. */
export const bandScale = (
  count: number,
  width: number,
  gapRatio = 0.3,
): { readonly step: number; readonly bandWidth: number; readonly at: Scale } => {
  const step = count === 0 ? width : width / count;
  const bandWidth = step * (1 - gapRatio);
  return {
    step,
    bandWidth,
    at: (index) => index * step + (step - bandWidth) / 2,
  };
};
