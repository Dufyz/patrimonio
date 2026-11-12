import { readJson, writeJson } from '../../lib/preferences.js';
import type { Storageish } from '../../lib/preferences.js';

/**
 * FIN-005 · Exibição: mostrar e ocultar colunas. A escolha persiste por tela,
 * no navegador. Coluna marcada como fixa — descrição, valor e a ação principal
 * da linha — nunca some.
 */

export type ColumnSpec = {
  readonly id: string;
  readonly label: string;
  /** Não pode ser ocultada. */
  readonly locked?: boolean;
};

export const columnsKey = (screen: string): string =>
  `patrimonio.finance.columns.${screen}`;

const isStringList = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

export const readHiddenColumns = (
  storage: Storageish | null,
  screen: string,
  columns: readonly ColumnSpec[],
): readonly string[] => {
  const stored = readJson(storage, columnsKey(screen), isStringList, []);
  const lockedIds = new Set(
    columns.filter((column) => column.locked === true).map((c) => c.id),
  );
  const known = new Set(columns.map((column) => column.id));
  return stored.filter((id) => known.has(id) && !lockedIds.has(id));
};

export const writeHiddenColumns = (
  storage: Storageish | null,
  screen: string,
  hidden: readonly string[],
): void => writeJson(storage, columnsKey(screen), hidden);

export const toggleColumn = (
  hidden: readonly string[],
  columns: readonly ColumnSpec[],
  id: string,
): readonly string[] => {
  if (columns.find((column) => column.id === id)?.locked === true) return hidden;
  return hidden.includes(id) ? hidden.filter((item) => item !== id) : [...hidden, id];
};

export const isColumnVisible = (hidden: readonly string[], id: string): boolean =>
  !hidden.includes(id);
