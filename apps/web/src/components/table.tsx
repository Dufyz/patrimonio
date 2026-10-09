import { useCallback, useMemo, useRef, useState } from 'react';

import { browserStorage } from '../lib/preferences.js';
import type { ColumnPreference, ColumnVisibility } from '../lib/table/columns.js';
import {
  readColumnPreference,
  visibleColumns,
  writeColumnPreference,
} from '../lib/table/columns.js';
import type { GroupSummary, TableGroup, TableState } from '../lib/table/model.js';
import {
  EMPTY_TABLE_STATE,
  buildRowModel,
  nextSort,
  toggle,
} from '../lib/table/model.js';
import { colorForToken } from '../lib/tokens.js';
import { useElementWidth } from './use_element_width.js';

/**
 * D-04 · A tabela densa.
 *
 * O componente é fino de propósito: agrupamento, ordenação, subtotal e colapso
 * de coluna são decididos em `lib/table/`, que tem teste. O que sobra aqui é a
 * marcação, o teclado e a aparência.
 *
 * Duas regras de desenho que vêm da prancha 18 e valem para toda tela:
 * nenhuma linha quebra em duas — texto longo corta com reticências e aparece
 * inteiro na dica —, e nenhuma tabela rola na horizontal: quando falta largura,
 * colunas secundárias somem em etapas.
 */

export type TableColumn<Row> = ColumnVisibility & {
  readonly header: string;
  /** Número alinha à direita; texto, à esquerda. */
  readonly numeric?: boolean | undefined;
  readonly sortable?: boolean | undefined;
  readonly sortValue?: ((row: Row) => string | null) | undefined;
  readonly cell: (row: Row) => React.ReactNode;
  readonly summary?: ((summary: GroupSummary) => React.ReactNode) | undefined;
  /** A coluna que ocupa o espaço que sobra e trunca. Só uma por tabela. */
  readonly flexible?: boolean | undefined;
};

export type DataTableProps<Row> = {
  /** Chave de persistência da escolha de colunas. Uma por tela. */
  readonly screen: string;
  readonly caption: string;
  readonly columns: readonly TableColumn<Row>[];
  readonly groups: readonly TableGroup<Row>[];
  readonly rowId: (row: Row) => string;
  readonly rowLabel: (row: Row) => string;
  readonly total?: GroupSummary | undefined;
  readonly rowsPerGroup?: number | undefined;
  readonly onOpenRow?: ((row: Row) => void) | undefined;
  readonly onNewTransaction?: ((row: Row) => void) | undefined;
  readonly onEditRow?: ((row: Row) => void) | undefined;
  readonly rowActions?: ((row: Row) => React.ReactNode) | undefined;
  readonly emptyState?: React.ReactNode;
  /** Largura imposta, para teste e para a comparação visual. */
  readonly width?: number | undefined;
};

const alignClass = (numeric: boolean): string => (numeric ? 'text-right' : 'text-left');

const SORT_GLYPH = { asc: '↑', desc: '↓' } as const;

const HEADER_TYPOGRAPHY =
  'text-label font-medium tracking-wide whitespace-nowrap text-ink-3 uppercase';

export const DataTable = <Row,>({
  screen,
  caption,
  columns,
  groups,
  rowId,
  rowLabel,
  total,
  rowsPerGroup,
  onOpenRow,
  onNewTransaction,
  onEditRow,
  rowActions,
  emptyState,
  width: forcedWidth,
}: DataTableProps<Row>): React.ReactElement => {
  const container = useRef<HTMLDivElement>(null);
  const measured = useElementWidth(container, 1440);
  const width = forcedWidth ?? measured;

  const storage = useMemo(() => browserStorage(), []);
  const [preference, setPreference] = useState<ColumnPreference>(() =>
    readColumnPreference(storage, screen),
  );
  const [state, setState] = useState<TableState>(EMPTY_TABLE_STATE);

  const shown = useMemo(
    () => visibleColumns(columns, width, preference),
    [columns, width, preference],
  );

  const sortValueOf = useCallback(
    (row: Row, columnId: string): string | null => {
      const column = columns.find((candidate) => candidate.id === columnId);
      return column?.sortValue?.(row) ?? null;
    },
    [columns],
  );

  const isNumericColumn = useCallback(
    (columnId: string): boolean =>
      columns.find((candidate) => candidate.id === columnId)?.numeric === true,
    [columns],
  );

  const model = useMemo(
    () =>
      buildRowModel<Row>({
        groups,
        state,
        rowId,
        sortValue: sortValueOf,
        isNumericColumn,
        ...(total === undefined ? {} : { total }),
        ...(rowsPerGroup === undefined ? {} : { rowsPerGroup }),
      }),
    [groups, state, rowId, sortValueOf, isNumericColumn, total, rowsPerGroup],
  );

  const dataRows = useMemo(() => model.filter((entry) => entry.kind === 'row'), [model]);

  const onSort = (columnId: string): void =>
    setState((current) => ({ ...current, sort: nextSort(current.sort, columnId) }));

  const updatePreference = (next: ColumnPreference): void => {
    setPreference(next);
    writeColumnPreference(storage, screen, next);
  };

  /**
   * Seta navega, Enter abre, `L` lança, `E` edita. Nenhum deles dispara com o
   * foco em campo de texto, porque a linha não contém campo de texto — o
   * mesmo cuidado em escala de aplicação é D-11.
   */
  const onRowKeyDown = (
    event: React.KeyboardEvent<HTMLTableRowElement>,
    row: Row,
  ): void => {
    const index = dataRows.findIndex((entry) => entry.id === rowId(row));
    const move = (delta: number): void => {
      const target = dataRows[index + delta];
      if (target === undefined) return;
      event.preventDefault();
      const next = event.currentTarget.parentElement?.querySelector<HTMLTableRowElement>(
        `tr[data-row-id="${CSS.escape(target.id)}"]`,
      );
      next?.focus();
    };

    switch (event.key) {
      case 'ArrowDown':
        move(1);
        return;
      case 'ArrowUp':
        move(-1);
        return;
      case 'Enter':
        event.preventDefault();
        onOpenRow?.(row);
        return;
      case 'l':
      case 'L':
        event.preventDefault();
        onNewTransaction?.(row);
        return;
      case 'e':
      case 'E':
        event.preventDefault();
        onEditRow?.(row);
        return;
      default:
        return;
    }
  };

  const hasRows = groups.some((group) => group.rows.length > 0);

  return (
    <div ref={container} className="w-full">
      <table
        className="w-full table-auto border-collapse text-cell"
        data-width-tier={width}
      >
        <caption className="sr-only">{caption}</caption>

        <thead>
          <tr className="border-b border-line">
            {shown.map((column) => (
              <th
                key={column.id}
                scope="col"
                className={`px-3 pb-2 ${alignClass(column.numeric === true)}`}
                aria-sort={
                  state.sort?.columnId === column.id
                    ? state.sort.direction === 'asc'
                      ? 'ascending'
                      : 'descending'
                    : 'none'
                }
              >
                {column.sortable === true ? (
                  <button
                    type="button"
                    // O `text-transform` do `th` não chega ao botão: a folha de
                    // estilo do navegador o zera em todo controle de formulário.
                    className={`${HEADER_TYPOGRAPHY} cursor-pointer hover:text-ink`}
                    onClick={() => onSort(column.id)}
                  >
                    {column.header}
                    {state.sort?.columnId === column.id
                      ? ` ${SORT_GLYPH[state.sort.direction]}`
                      : ''}
                  </button>
                ) : (
                  <span className={HEADER_TYPOGRAPHY}>{column.header}</span>
                )}
              </th>
            ))}
            {rowActions === undefined ? null : <th className="w-8" />}
          </tr>
        </thead>

        <tbody>
          {!hasRows && emptyState !== undefined ? (
            <tr>
              <td colSpan={shown.length + (rowActions === undefined ? 0 : 1)}>
                {emptyState}
              </td>
            </tr>
          ) : null}

          {model.map((entry) => {
            if (entry.kind === 'group') {
              return (
                <tr key={entry.id} className="bg-panel-2">
                  {shown.map((column, index) => (
                    <td
                      key={column.id}
                      className={`h-(--row-height-group) px-3 font-semibold ${alignClass(
                        column.numeric === true,
                      )}`}
                    >
                      {index === 0 ? (
                        <button
                          type="button"
                          className="flex cursor-pointer items-center gap-2 whitespace-nowrap"
                          aria-expanded={!entry.collapsed}
                          onClick={() =>
                            setState((current) => ({
                              ...current,
                              collapsedGroups: toggle(
                                current.collapsedGroups,
                                entry.group.key,
                              ),
                            }))
                          }
                        >
                          <span aria-hidden="true" className="text-ink-3">
                            {entry.collapsed ? '›' : '⌄'}
                          </span>
                          <span
                            aria-hidden="true"
                            className="size-2 rounded-xs"
                            style={{
                              backgroundColor: colorForToken(entry.group.colorToken),
                            }}
                          />
                          {entry.group.label}
                          <span className="font-normal text-ink-3">{entry.count}</span>
                        </button>
                      ) : (
                        column.summary?.(entry.group.summary)
                      )}
                    </td>
                  ))}
                  {rowActions === undefined ? null : <td />}
                </tr>
              );
            }

            if (entry.kind === 'more') {
              return (
                <tr key={entry.id}>
                  <td
                    colSpan={shown.length + (rowActions === undefined ? 0 : 1)}
                    className="h-(--row-height-group) px-3"
                  >
                    <button
                      type="button"
                      className="cursor-pointer text-accent hover:underline"
                      onClick={() =>
                        setState((current) => ({
                          ...current,
                          expandedGroups: toggle(current.expandedGroups, entry.groupKey),
                        }))
                      }
                    >
                      {`Mostrar mais ${entry.hiddenCount} ${entry.groupLabel.toLowerCase()}`}
                    </button>
                  </td>
                </tr>
              );
            }

            if (entry.kind === 'total') {
              return (
                <tr key={entry.id} className="border-t border-line font-semibold">
                  {shown.map((column, index) => (
                    <td
                      key={column.id}
                      className={`h-(--row-height) px-3 ${alignClass(
                        column.numeric === true,
                      )}`}
                    >
                      {index === 0 ? 'Total' : column.summary?.(entry.summary)}
                    </td>
                  ))}
                  {rowActions === undefined ? null : <td />}
                </tr>
              );
            }

            const selected = state.selectedRowId === entry.id;

            return (
              <tr
                key={entry.id}
                data-row-id={entry.id}
                tabIndex={0}
                aria-selected={selected}
                aria-label={rowLabel(entry.row)}
                className={`group border-b border-line/60 outline-offset-[-2px] ${
                  selected ? 'bg-accent-soft' : 'hover:bg-panel-2'
                }`}
                onFocus={() =>
                  setState((current) => ({ ...current, selectedRowId: entry.id }))
                }
                onClick={() =>
                  setState((current) => ({ ...current, selectedRowId: entry.id }))
                }
                onDoubleClick={() => onOpenRow?.(entry.row)}
                onKeyDown={(event) => onRowKeyDown(event, entry.row)}
              >
                {shown.map((column) => (
                  <td
                    key={column.id}
                    className={`h-(--row-height) px-3 ${alignClass(
                      column.numeric === true,
                    )} ${
                      column.flexible === true
                        ? 'w-full max-w-0 truncate'
                        : 'whitespace-nowrap'
                    }`}
                  >
                    {column.cell(entry.row)}
                  </td>
                ))}
                {rowActions === undefined ? null : (
                  <td className="px-1 opacity-0 focus-within:opacity-100 group-hover:opacity-100">
                    {rowActions(entry.row)}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>

      <ColumnMenu
        columns={columns}
        preference={preference}
        width={width}
        onChange={updatePreference}
      />
    </div>
  );
};

type ColumnMenuProps<Row> = {
  readonly columns: readonly TableColumn<Row>[];
  readonly preference: ColumnPreference;
  readonly width: number;
  readonly onChange: (preference: ColumnPreference) => void;
};

/**
 * A escolha de colunas. Fica fora da tabela, no rodapé, e não no cabeçalho:
 * quem abre a tela quer ver os números, e quem quer trocar coluna faz isso uma
 * vez por mês.
 */
const ColumnMenu = <Row,>({
  columns,
  preference,
  width,
  onChange,
}: ColumnMenuProps<Row>): React.ReactElement => {
  const optional = columns.filter((column) => column.essential !== true);

  return (
    <details className="mt-2 text-label text-ink-3">
      <summary className="cursor-pointer tracking-wide uppercase">Colunas</summary>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {optional.map((column) => {
          const byWidth = column.hideBelow !== undefined && width < column.hideBelow;
          return (
            <label key={column.id} className="flex items-center gap-1.5 normal-case">
              <input
                type="checkbox"
                checked={!preference.hidden.includes(column.id)}
                onChange={() =>
                  onChange({
                    order: preference.order,
                    hidden: preference.hidden.includes(column.id)
                      ? preference.hidden.filter((id) => id !== column.id)
                      : [...preference.hidden, column.id],
                  })
                }
              />
              {column.header}
              {byWidth ? (
                <span className="text-ink-3">· sem espaço nesta largura</span>
              ) : null}
            </label>
          );
        })}
      </div>
    </details>
  );
};
