import { browserStorage, readRaw, writeRaw } from './preferences.js';

/**
 * NAV-04 · A última carteira aberta. As telas de carteira que a barra lateral
 * lista (Posições, Estratégia…) abrem nela quando a URL de agora não traz uma:
 * em Lançamentos, por exemplo, não há carteira, e o item Posições continua
 * levando a algum lugar.
 *
 * Guardado por aparelho, como o recolhimento da barra lateral.
 */

const SCOPE_KEY = 'patrimonio.last-scope';

export const readLastScope = (): string | null => readRaw(browserStorage(), SCOPE_KEY);

export const writeLastScope = (scope: string): void =>
  writeRaw(browserStorage(), SCOPE_KEY, scope);
