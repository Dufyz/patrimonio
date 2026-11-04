/**
 * FIN-005 · Filtros de tabela.
 *
 * Tipo, categoria, conta e situação são filtros de múltipla escolha na barra de
 * ferramentas — nunca controles segmentados. Um campo sem nenhuma opção marcada
 * não filtra nada.
 */

export type FilterOption = { readonly value: string; readonly label: string };

export type FilterField = {
  readonly id: string;
  readonly label: string;
  readonly options: readonly FilterOption[];
};

export type FilterState = Readonly<Record<string, readonly string[]>>;

export const EMPTY_FILTERS: FilterState = {};

export const toggleFilterValue = (
  state: FilterState,
  field: string,
  value: string,
): FilterState => {
  const current = state[field] ?? [];
  const next = current.includes(value)
    ? current.filter((item) => item !== value)
    : [...current, value];
  const rest = Object.fromEntries(Object.entries(state).filter(([key]) => key !== field));
  return next.length === 0 ? rest : { ...rest, [field]: next };
};

export const clearFilterField = (state: FilterState, field: string): FilterState => {
  return Object.fromEntries(Object.entries(state).filter(([key]) => key !== field));
};

export const countActiveFilters = (state: FilterState): number =>
  Object.values(state).reduce((total, values) => total + values.length, 0);

/** O registro passa quando, em cada campo ativo, o valor dele está entre os marcados. */
export const passesFilters = (
  state: FilterState,
  valueOf: (field: string) => string | readonly string[],
): boolean =>
  Object.entries(state).every(([field, selected]) => {
    if (selected.length === 0) return true;
    const value = valueOf(field);
    const values = typeof value === 'string' ? [value] : value;
    return values.some((item) => selected.includes(item));
  });

export type AppliedChip = {
  readonly id: string;
  readonly field: string;
  readonly value: string;
  readonly label: string;
};

/** Os filtros ativos como etiquetas removíveis uma a uma. */
export const appliedChips = (
  fields: readonly FilterField[],
  state: FilterState,
): readonly AppliedChip[] =>
  fields.flatMap((field) =>
    (state[field.id] ?? []).map((value) => ({
      id: `${field.id}:${value}`,
      field: field.id,
      value,
      label: `${field.label}: ${field.options.find((option) => option.value === value)?.label ?? value}`,
    })),
  );
