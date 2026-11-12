import { AREAS } from './routes.js';
import type { AreaId } from './routes.js';
import { browserStorage, readEnum, readRaw, writeRaw } from './preferences.js';

/**
 * NAV-004 · A área e a tela em que a pessoa estava. Clicar numa área da barra
 * lateral volta à última tela usada nela; sem histórico, abre a Visão geral. O
 * escopo de Investimentos também é lembrado: abrir uma tela de Investimentos
 * estando em Geral ou Finanças usa a última carteira.
 *
 * Guardado por aparelho, como o recolhimento da barra lateral.
 */

export type LastArea = AreaId;

const AREA_KEY = 'patrimonio.last-area';
const SCOPE_KEY = 'patrimonio.last-scope';
const pathKey = (area: AreaId): string => `patrimonio.last-path.${area}`;

export const readLastArea = (): LastArea =>
  readEnum(browserStorage(), AREA_KEY, AREAS, 'geral');

export const writeLastArea = (area: LastArea): void =>
  writeRaw(browserStorage(), AREA_KEY, area);

export const readLastScope = (): string | null => readRaw(browserStorage(), SCOPE_KEY);

export const writeLastScope = (scope: string): void =>
  writeRaw(browserStorage(), SCOPE_KEY, scope);

/** O último caminho (sem busca) visitado na área. */
export const readLastPath = (area: AreaId): string | null =>
  readRaw(browserStorage(), pathKey(area));

export const writeLastPath = (area: AreaId, path: string): void =>
  writeRaw(browserStorage(), pathKey(area), path);
