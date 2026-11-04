/**
 * FIN-006 · A paleta de cores de categoria.
 *
 * A categoria guarda o identificador da cor (`violet`), nunca um hexadecimal: é o
 * que mantém a cor igual em tabelas, barras e gráficos, e dá a ela uma variante
 * em cada tema. A cor vem de uma paleta predefinida.
 */

export const CATEGORY_PALETTE = [
  { id: 'violet', label: 'Violeta' },
  { id: 'slate', label: 'Ardósia' },
  { id: 'rose', label: 'Rosa' },
  { id: 'blue', label: 'Azul' },
  { id: 'brown', label: 'Marrom' },
  { id: 'teal', label: 'Turquesa' },
  { id: 'gray', label: 'Cinza' },
  { id: 'olive', label: 'Oliva' },
  { id: 'green', label: 'Verde' },
  { id: 'orange', label: 'Laranja' },
  { id: 'cyan', label: 'Ciano' },
  { id: 'indigo', label: 'Índigo' },
] as const;

export type CategoryColorId = (typeof CATEGORY_PALETTE)[number]['id'];

export const isCategoryColor = (value: unknown): value is CategoryColorId =>
  CATEGORY_PALETTE.some((color) => color.id === value);

/** `violet` → `var(--color-cat-violet)`. Cor desconhecida cai em cinza, nunca some. */
export const categoryColor = (id: string | null | undefined): string =>
  `var(--color-cat-${isCategoryColor(id) ? id : 'gray'})`;
