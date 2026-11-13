/**
 * LAN-04 · Os filtros do livro vivem na URL: links de outras telas chegam com o
 * filtro aplicado (NAV-12) e a troca de agrupamento não os perde.
 */
export type LedgerFilters = {
  readonly q: string;
  readonly tipo: readonly string[];
  readonly situacao: readonly string[];
  readonly conta: readonly string[];
  readonly carteira: readonly string[];
  readonly categoria: readonly string[];
};

export const EMPTY_FILTERS: LedgerFilters = {
  q: '',
  tipo: [],
  situacao: [],
  conta: [],
  carteira: [],
  categoria: [],
};

const LIST_KEYS = ['tipo', 'situacao', 'conta', 'carteira', 'categoria'] as const;

const list = (value: string | null): readonly string[] =>
  value === null || value === '' ? [] : value.split(',');

export const filtersFromParams = (params: URLSearchParams): LedgerFilters => ({
  q: params.get('q') ?? '',
  tipo: list(params.get('tipo')),
  situacao: list(params.get('situacao')),
  conta: list(params.get('conta')),
  carteira: list(params.get('carteira')),
  categoria: list(params.get('categoria')),
});

/** Escreve os filtros sobre os parâmetros atuais, preservando os que não são deles. */
export const filtersToParams = (
  filters: LedgerFilters,
  base: URLSearchParams = new URLSearchParams(),
): URLSearchParams => {
  const params = new URLSearchParams(base);
  if (filters.q === '') params.delete('q');
  else params.set('q', filters.q);
  for (const key of LIST_KEYS) {
    if (filters[key].length === 0) params.delete(key);
    else params.set(key, filters[key].join(','));
  }
  return params;
};

export const hasFilters = (filters: LedgerFilters): boolean =>
  filters.q !== '' || LIST_KEYS.some((key) => filters[key].length > 0);

export type FilterChip = {
  readonly key: (typeof LIST_KEYS)[number] | 'q';
  readonly value: string;
  readonly label: string;
};

/** Cada valor ativo vira um chip removível. */
export const chipsOf = (
  filters: LedgerFilters,
  labelOf: (key: FilterChip['key'], value: string) => string = (_k, v) => v,
): readonly FilterChip[] => [
  ...(filters.q === ''
    ? []
    : [{ key: 'q' as const, value: filters.q, label: `Busca: ${filters.q}` }]),
  ...LIST_KEYS.flatMap((key) =>
    filters[key].map((value) => ({ key, value, label: labelOf(key, value) })),
  ),
];

export const removeChip = (filters: LedgerFilters, chip: FilterChip): LedgerFilters =>
  chip.key === 'q'
    ? { ...filters, q: '' }
    : { ...filters, [chip.key]: filters[chip.key].filter((v) => v !== chip.value) };
