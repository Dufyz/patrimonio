import { compareDecimal } from '../decimal.js';

/**
 * D-04 · O modelo de linhas da tabela densa.
 *
 * A tabela é o componente central da aplicação, e tudo que ela decide — que
 * grupo aparece, em que ordem, quais linhas cabem antes do "mostrar mais" —
 * decide-se aqui, em função pura. Regra dentro de componente não é testável,
 * e esta é a regra que, errada, faz a soma da tela não bater com a do extrato.
 *
 * Um ponto que parece detalhe e não é: **o subtotal não é calculado aqui**. Ele
 * chega pronto da `api`, junto com o grupo. O `web` não faz aritmética com
 * dinheiro (`Arquitetura e tecnologias`, "O que atravessa o fio"), e é
 * justamente por isso que o subtotal continua correto quando "mostrar mais"
 * esconde nove das catorze linhas: ele nunca dependeu das linhas visíveis.
 */

/** Quantas linhas um grupo mostra antes do "mostrar mais". */
export const DEFAULT_ROWS_PER_GROUP = 5;

export type GroupSummary = Readonly<Record<string, string | null>>;

export type TableGroup<Row> = {
  readonly key: string;
  readonly label: string;
  /** Token de cor da classe, quando o agrupamento é por categoria. */
  readonly colorToken?: string | undefined;
  readonly rows: readonly Row[];
  /** Subtotais por coluna, calculados pela `api` sobre o grupo inteiro. */
  readonly summary: GroupSummary;
};

export type SortDirection = 'asc' | 'desc';

export type Sort = {
  readonly columnId: string;
  readonly direction: SortDirection;
};

export type TableState = {
  readonly sort: Sort | null;
  /** Grupos fechados pelo acento. */
  readonly collapsedGroups: readonly string[];
  /** Grupos em que o "mostrar mais" já foi acionado. */
  readonly expandedGroups: readonly string[];
  readonly selectedRowId: string | null;
  /**
   * A linha aberta em detalhe, abaixo dela mesma. Uma por vez: duas abertas
   * empurram a terceira para fora da tela, e a comparação que a tabela existe
   * para permitir é justamente entre linhas vizinhas.
   */
  readonly expandedRowId: string | null;
};

export const EMPTY_TABLE_STATE: TableState = {
  sort: null,
  collapsedGroups: [],
  expandedGroups: [],
  selectedRowId: null,
  expandedRowId: null,
};

export type RenderRow<Row> =
  | {
      readonly kind: 'group';
      readonly id: string;
      readonly group: TableGroup<Row>;
      readonly collapsed: boolean;
      /** Quantas linhas o grupo tem ao todo, mostrando ou não. */
      readonly count: number;
    }
  | { readonly kind: 'row'; readonly id: string; readonly row: Row }
  | {
      /** O detalhe da linha aberta, logo abaixo dela e na largura inteira. */
      readonly kind: 'expansion';
      readonly id: string;
      readonly rowId: string;
      readonly row: Row;
    }
  | {
      readonly kind: 'more';
      readonly id: string;
      readonly groupKey: string;
      readonly hiddenCount: number;
      readonly groupLabel: string;
    }
  | { readonly kind: 'total'; readonly id: string; readonly summary: GroupSummary };

export type SortValue = (row: unknown, columnId: string) => string | null;

export type BuildRowModelInput<Row> = {
  readonly groups: readonly TableGroup<Row>[];
  readonly state: TableState;
  readonly rowId: (row: Row) => string;
  /**
   * O valor pelo qual a coluna ordena. Decimal em string ordena por grandeza,
   * texto ordena por localidade — quem decide é `isNumeric`.
   */
  readonly sortValue: (row: Row, columnId: string) => string | null;
  readonly isNumericColumn: (columnId: string) => boolean;
  readonly total?: GroupSummary | undefined;
  readonly rowsPerGroup?: number | undefined;
  /** A tabela sabe desenhar detalhe de linha. Sem isso, abrir não produz nada. */
  readonly expandable?: boolean | undefined;
};

const compareText = (left: string | null, right: string | null): number => {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left.localeCompare(right, 'pt-BR', { sensitivity: 'base', numeric: true });
};

const sortRows = <Row>(
  rows: readonly Row[],
  sort: Sort,
  sortValue: (row: Row, columnId: string) => string | null,
  numeric: boolean,
): readonly Row[] => {
  const compare = numeric ? compareDecimal : compareText;
  const sign = sort.direction === 'asc' ? 1 : -1;

  // `toSorted` preserva a ordem de entrada nos empates, então a ordem que a
  // `api` escolheu continua valendo dentro de cada valor repetido.
  return rows.toSorted(
    (left, right) =>
      sign * compare(sortValue(left, sort.columnId), sortValue(right, sort.columnId)),
  );
};

/**
 * Ordena os grupos entre si pelo subtotal da mesma coluna. Ordenar por valor
 * sem isto deixaria "Ações" acima de "Renda fixa" mesmo com metade do valor,
 * e a tabela pareceria desordenada.
 */
const sortGroups = <Row>(
  groups: readonly TableGroup<Row>[],
  sort: Sort,
  numeric: boolean,
): readonly TableGroup<Row>[] => {
  const compare = numeric ? compareDecimal : compareText;
  const sign = sort.direction === 'asc' ? 1 : -1;

  return groups.toSorted(
    (left, right) =>
      sign *
      compare(left.summary[sort.columnId] ?? null, right.summary[sort.columnId] ?? null),
  );
};

/**
 * Transforma grupos e estado na lista plana que a tabela desenha. O grupo
 * fechado some com suas linhas mas mantém o cabeçalho e o subtotal, porque
 * fechar um grupo é esconder detalhe, não excluir dinheiro da conta.
 */
export const buildRowModel = <Row>(
  input: BuildRowModelInput<Row>,
): readonly RenderRow<Row>[] => {
  const limit = input.rowsPerGroup ?? DEFAULT_ROWS_PER_GROUP;
  const { sort } = input.state;
  const numeric = sort === null ? false : input.isNumericColumn(sort.columnId);

  const groups = sort === null ? input.groups : sortGroups(input.groups, sort, numeric);
  const out: RenderRow<Row>[] = [];
  const singleGroup = groups.length === 1 && groups[0]?.key === UNGROUPED_KEY;

  for (const group of groups) {
    const collapsed = input.state.collapsedGroups.includes(group.key);

    if (!singleGroup) {
      out.push({
        kind: 'group',
        id: `group:${group.key}`,
        group,
        collapsed,
        count: group.rows.length,
      });
    }

    if (collapsed) continue;

    const ordered =
      sort === null ? group.rows : sortRows(group.rows, sort, input.sortValue, numeric);
    const expanded = input.state.expandedGroups.includes(group.key);
    const shown = expanded ? ordered : ordered.slice(0, limit);

    for (const row of shown) {
      const id = input.rowId(row);
      out.push({ kind: 'row', id, row });

      if (input.expandable === true && input.state.expandedRowId === id) {
        out.push({ kind: 'expansion', id: `expansion:${id}`, rowId: id, row });
      }
    }

    const hiddenCount = ordered.length - shown.length;
    if (hiddenCount > 0) {
      out.push({
        kind: 'more',
        id: `more:${group.key}`,
        groupKey: group.key,
        hiddenCount,
        groupLabel: group.label,
      });
    }
  }

  if (input.total !== undefined) {
    out.push({ kind: 'total', id: 'total', summary: input.total });
  }

  return out;
};

/** A chave do grupo único usado quando a tabela não agrupa. */
export const UNGROUPED_KEY = '__sem_grupo__';

export const ungrouped = <Row>(
  rows: readonly Row[],
  summary: GroupSummary = {},
): readonly TableGroup<Row>[] => [{ key: UNGROUPED_KEY, label: '', rows, summary }];

/** Abre a linha, ou fecha a que já estava aberta. */
export const toggleRow = (current: string | null, id: string): string | null =>
  current === id ? null : id;

export const toggle = (list: readonly string[], key: string): readonly string[] =>
  list.includes(key) ? list.filter((item) => item !== key) : [...list, key];

/**
 * O próximo estado de ordenação ao clicar no cabeçalho. Três passos e não dois:
 * voltar à ordem da `api` precisa ser possível sem recarregar a tela.
 */
export const nextSort = (current: Sort | null, columnId: string): Sort | null => {
  if (current === null || current.columnId !== columnId) {
    return { columnId, direction: 'desc' };
  }
  if (current.direction === 'desc') return { columnId, direction: 'asc' };
  return null;
};
