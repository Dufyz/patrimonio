/**
 * CMP-03 (4) · Ordenar clicando no cabeçalho: o primeiro clique ordena de forma
 * crescente, o segundo inverte e o terceiro volta à ordem padrão da tela. A
 * troca de coluna recomeça pelo crescente.
 *
 * Funções puras: o estado mora na tela, e a ordem padrão é a das linhas como
 * chegaram — `null` devolve a mesma lista, sem reordenar nada.
 */

export type SortDirection = 'asc' | 'desc';
export type SortState = { readonly key: string; readonly dir: SortDirection } | null;

export const nextSort = (current: SortState, key: string): SortState => {
  if (current === null || current.key !== key) return { key, dir: 'asc' };
  return current.dir === 'asc' ? { key, dir: 'desc' } : null;
};

export const ariaSort = (
  current: SortState,
  key: string,
): 'ascending' | 'descending' | 'none' => {
  if (current === null || current.key !== key) return 'none';
  return current.dir === 'asc' ? 'ascending' : 'descending';
};

export type SortValue = string | number | bigint | null | undefined;

const compare = (a: SortValue, b: SortValue): number => {
  if (typeof a === 'bigint' && typeof b === 'bigint') return a < b ? -1 : a > b ? 1 : 0;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'pt-BR', { sensitivity: 'base' });
};

/**
 * Ordena sem mexer na lista de entrada. A ordenação é estável (empate mantém a
 * ordem da tela) e valor ausente vai sempre para o fim, em qualquer sentido:
 * "sem data" não é o menor nem o maior, é o que não tem o que comparar.
 */
export const sortRows = <Row>(
  rows: readonly Row[],
  state: SortState,
  accessors: Readonly<Record<string, (row: Row) => SortValue>>,
): readonly Row[] => {
  if (state === null) return rows;
  const read = accessors[state.key];
  if (read === undefined) return rows;

  const sign = state.dir === 'asc' ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index, value: read(row) }))
    .sort((a, b) => {
      const aMissing = a.value === null || a.value === undefined;
      const bMissing = b.value === null || b.value === undefined;
      if (aMissing || bMissing) {
        return aMissing === bMissing ? a.index - b.index : aMissing ? 1 : -1;
      }
      return sign * compare(a.value, b.value) || a.index - b.index;
    })
    .map(({ row }) => row);
};
