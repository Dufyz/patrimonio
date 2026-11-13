import { fromCents, toCents } from './projection_view.js';

/**
 * CAT-01/02 · A tabela de categorias: lançado e previsto do período por
 * categoria, busca, filtros e ordenação. Valores em centavos inteiros.
 */
export type CategoryKind = 'receita' | 'despesa';
export type Nature = 'fixa' | 'livre';

export type CategoryItem = {
  readonly id: string;
  readonly name: string;
  readonly kind: CategoryKind;
  readonly color: string;
  readonly nature?: Nature | null | undefined;
  readonly archived: boolean;
};

export type CategoryLine = CategoryItem & {
  readonly posted: string;
  readonly planned: string;
  readonly entriesTotal: number;
};

export type CategorySort = 'nome' | 'lancado' | 'previsto';

export type CategoryFilters = {
  readonly q: string;
  readonly kind: CategoryKind | '';
  readonly nature: Nature | '';
};

export const EMPTY_CATEGORY_FILTERS: CategoryFilters = { q: '', kind: '', nature: '' };

export const hasCategoryFilters = (filters: CategoryFilters): boolean =>
  filters.q.trim() !== '' || filters.kind !== '' || filters.nature !== '';

export const linesOf = (
  categories: readonly CategoryItem[],
  usage: ReadonlyMap<
    string,
    { readonly posted: string; readonly planned: string; readonly entries_total: number }
  >,
): readonly CategoryLine[] =>
  categories
    .filter((category) => !category.archived)
    .map((category) => {
      const row = usage.get(category.id);
      return {
        ...category,
        posted: row?.posted ?? '0.00',
        planned: row?.planned ?? '0.00',
        entriesTotal: row?.entries_total ?? 0,
      };
    });

export const filterLines = (
  lines: readonly CategoryLine[],
  filters: CategoryFilters,
): readonly CategoryLine[] => {
  const q = filters.q.trim().toLowerCase();
  return lines.filter(
    (line) =>
      (q === '' || line.name.toLowerCase().includes(q)) &&
      (filters.kind === '' || line.kind === filters.kind) &&
      (filters.nature === '' || line.nature === filters.nature),
  );
};

export const sortLines = (
  lines: readonly CategoryLine[],
  by: CategorySort,
): readonly CategoryLine[] =>
  [...lines].sort((a, b) => {
    if (by === 'nome') return a.name.localeCompare(b.name, 'pt-BR');
    const key = by === 'lancado' ? 'posted' : 'planned';
    const diff = toCents(b[key]) - toCents(a[key]);
    return diff === 0n ? a.name.localeCompare(b.name, 'pt-BR') : diff > 0n ? 1 : -1;
  });

/** O total da seção sobre as linhas visíveis. */
export const sectionTotal = (
  lines: readonly CategoryLine[],
  key: 'posted' | 'planned',
): string => fromCents(lines.reduce((sum, line) => sum + toCents(line[key]), 0n));

/** Uma categoria sem nada no período mostra `0` e `—`: o traço é para o vazio, não o zero. */
export const isEmptyPeriod = (value: string): boolean => toCents(value) === 0n;
