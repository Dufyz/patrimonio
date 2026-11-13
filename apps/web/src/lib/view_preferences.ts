import { browserStorage, readEnum, readRaw, writeRaw } from './preferences.js';
import type { Storageish } from './preferences.js';

/**
 * CMP-13 · O que o app lembra, por aparelho.
 *
 * Persistem: tema, barra recolhida, mascaramento, colunas visíveis por tela, o
 * último agrupamento de Lançamentos e de Posições e a última tela por escopo.
 * **Não persistem**: período e filtros — ao abrir, o período é o padrão de
 * Configurações e os filtros estão limpos. `assertNotPersistable` existe para
 * que ninguém grave uma dessas duas coisas por engano.
 *
 * Armazenamento indisponível devolve sempre o padrão: o app funciona.
 */
export const GROUPING_SCREENS = ['lancamentos', 'posicoes'] as const;
export type GroupingScreen = (typeof GROUPING_SCREENS)[number];

const groupingKey = (screen: GroupingScreen): string => `patrimonio.grouping.${screen}`;
const screenKey = (scope: string): string => `patrimonio.last-screen.${scope}`;

export const readGrouping = <T extends string>(
  screen: GroupingScreen,
  allowed: readonly T[],
  fallback: T,
  storage: Storageish | null = browserStorage(),
): T => readEnum(storage, groupingKey(screen), allowed, fallback);

export const writeGrouping = (
  screen: GroupingScreen,
  value: string,
  storage: Storageish | null = browserStorage(),
): void => writeRaw(storage, groupingKey(screen), value);

/** A última tela aberta em um escopo (`todas` ou o id da carteira). */
export const readLastScreen = (
  scope: string,
  storage: Storageish | null = browserStorage(),
): string | null => readRaw(storage, screenKey(scope));

export const writeLastScreen = (
  scope: string,
  screen: string,
  storage: Storageish | null = browserStorage(),
): void => writeRaw(storage, screenKey(scope), screen);

/** Período e filtro são da sessão: gravá-los é erro de quem chama. */
export const assertNotPersistable = (key: string): void => {
  if (/period|periodo|filter|filtro/iu.test(key)) {
    throw new Error(`"${key}" não persiste entre sessões (CMP-13)`);
  }
};
