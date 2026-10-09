import type { Storageish } from '../preferences.js';
import { readJson, writeJson } from '../preferences.js';

/**
 * D-04 · Quais colunas aparecem, em que ordem.
 *
 * Duas forças decidem isso e elas não se misturam: a escolha de quem usa, que
 * persiste por tela, e a largura disponível, que é do momento. A segunda nunca
 * grava nada — diminuir a janela não pode apagar a preferência de quem a abriu
 * grande.
 *
 * As etapas de largura vêm da prancha 18: em vez de rolagem horizontal ou de
 * texto quebrado em duas linhas, as colunas secundárias somem em ordem
 * definida. A tabela ocupa 100% da largura em qualquer uma delas.
 */

export const WIDTH_TIERS = [1400, 1100, 1000, 600] as const;

export type WidthTier = (typeof WIDTH_TIERS)[number];

export type ColumnVisibility = {
  readonly id: string;
  /**
   * Coluna que nunca some: sem ela a linha não se identifica. Em Posições é o
   * ativo e o valor — uma tabela de posições sem valor não é uma tabela.
   */
  readonly essential?: boolean | undefined;
  /** Some quando a largura fica abaixo desta etapa. */
  readonly hideBelow?: WidthTier | undefined;
};

export type ColumnPreference = {
  readonly order: readonly string[];
  readonly hidden: readonly string[];
};

export const EMPTY_COLUMN_PREFERENCE: ColumnPreference = { order: [], hidden: [] };

const columnKey = (screen: string): string => `patrimonio.columns.${screen}`;

const isColumnPreference = (value: unknown): value is ColumnPreference => {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    Array.isArray(candidate['order']) &&
    Array.isArray(candidate['hidden']) &&
    candidate['order'].every((item) => typeof item === 'string') &&
    candidate['hidden'].every((item) => typeof item === 'string')
  );
};

export const readColumnPreference = (
  storage: Storageish | null,
  screen: string,
): ColumnPreference =>
  readJson(storage, columnKey(screen), isColumnPreference, EMPTY_COLUMN_PREFERENCE);

export const writeColumnPreference = (
  storage: Storageish | null,
  screen: string,
  preference: ColumnPreference,
): void => writeJson(storage, columnKey(screen), preference);

/**
 * A ordem declarada pelo componente, reordenada pela preferência. Uma coluna
 * nova, acrescentada em uma versão posterior, aparece na posição em que foi
 * declarada em vez de ir para o fim — quem já tinha uma preferência gravada
 * não fica sem a coluna nova nem a recebe no lugar errado.
 */
export const orderColumns = <C extends ColumnVisibility>(
  columns: readonly C[],
  preference: ColumnPreference,
): readonly C[] => {
  const known = new Set(columns.map((column) => column.id));
  const ranked = preference.order.filter((id) => known.has(id));
  if (ranked.length === 0) return columns;

  const rank = new Map(ranked.map((id, index) => [id, index]));
  const out = [...columns];

  // Coluna fora da preferência herda a posição do vizinho declarado antes dela.
  let inherited = -1;
  const effective = new Map<string, number>();
  for (const column of columns) {
    const position = rank.get(column.id);
    if (position === undefined) {
      effective.set(column.id, inherited + 0.5);
    } else {
      inherited = position;
      effective.set(column.id, position);
    }
  }

  return out.toSorted(
    (left, right) => (effective.get(left.id) ?? 0) - (effective.get(right.id) ?? 0),
  );
};

/**
 * As colunas que cabem. Essencial ignora tanto a largura quanto a preferência:
 * esconder o valor de uma tabela de valores é um estado do qual não se volta
 * sem reabrir o menu de colunas.
 */
export const visibleColumns = <C extends ColumnVisibility>(
  columns: readonly C[],
  width: number,
  preference: ColumnPreference = EMPTY_COLUMN_PREFERENCE,
): readonly C[] =>
  orderColumns(columns, preference).filter((column) => {
    if (column.essential === true) return true;
    if (preference.hidden.includes(column.id)) return false;
    return column.hideBelow === undefined || width >= column.hideBelow;
  });

/**
 * As colunas que a largura esconde agora, para o menu de colunas poder dizer
 * "some nesta largura" em vez de deixar a caixa marcada e a coluna ausente.
 */
export const hiddenByWidth = <C extends ColumnVisibility>(
  columns: readonly C[],
  width: number,
): readonly string[] =>
  columns
    .filter(
      (column) =>
        column.essential !== true &&
        column.hideBelow !== undefined &&
        width < column.hideBelow,
    )
    .map((column) => column.id);

export const toggleColumn = (
  preference: ColumnPreference,
  columnId: string,
): ColumnPreference => ({
  order: preference.order,
  hidden: preference.hidden.includes(columnId)
    ? preference.hidden.filter((id) => id !== columnId)
    : [...preference.hidden, columnId],
});

/** Move uma coluna para a posição de outra, no menu de colunas. */
export const moveColumn = <C extends ColumnVisibility>(
  columns: readonly C[],
  preference: ColumnPreference,
  columnId: string,
  toIndex: number,
): ColumnPreference => {
  const current = orderColumns(columns, preference).map((column) => column.id);
  const from = current.indexOf(columnId);
  if (from === -1) return preference;

  const next = [...current];
  next.splice(from, 1);
  next.splice(Math.max(0, Math.min(toIndex, next.length)), 0, columnId);
  return { order: next, hidden: preference.hidden };
};
