/**
 * Faixas de cor da barra de consumo do limite do cartão: verde até 70%, âmbar de
 * 70% a 90%, vermelho acima. O percentual nunca depende só da cor — vai ao lado
 * da barra, em texto.
 */

export type LimitTone = 'ok' | 'warn' | 'high';

export const LIMIT_WARN_FROM = 70;
export const LIMIT_HIGH_ABOVE = 90;

export const limitTone = (percent: number): LimitTone => {
  if (percent > LIMIT_HIGH_ABOVE) return 'high';
  if (percent >= LIMIT_WARN_FROM) return 'warn';
  return 'ok';
};

/**
 * Percentual de uso, com uma casa decimal, a partir de centavos inteiros. A
 * divisão é feita em inteiros e só o resultado vira número de exibição:
 * `348217 ÷ 566000` → `61.5`.
 */
export const usedPercent = (used: number, limit: number): number =>
  limit <= 0 ? 0 : Math.round((used * 1000) / limit) / 10;
