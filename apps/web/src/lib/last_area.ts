import { browserStorage, readEnum, readRaw, writeRaw } from './preferences.js';

/**
 * A área em que a pessoa estava. Configurações é global (`/configuracoes`) e
 * não pertence a nenhuma área; esta preferência diz qual barra lateral mostrar
 * em volta dela, e também o escopo de Investimentos para onde voltar.
 */

const AREAS = ['investimentos', 'financas'] as const;
export type LastArea = (typeof AREAS)[number];

const AREA_KEY = 'patrimonio.last-area';
const SCOPE_KEY = 'patrimonio.last-scope';

export const readLastArea = (): LastArea =>
  readEnum(browserStorage(), AREA_KEY, AREAS, 'investimentos');

export const writeLastArea = (area: LastArea): void =>
  writeRaw(browserStorage(), AREA_KEY, area);

export const readLastScope = (): string | null => readRaw(browserStorage(), SCOPE_KEY);

export const writeLastScope = (scope: string): void =>
  writeRaw(browserStorage(), SCOPE_KEY, scope);
