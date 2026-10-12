import { useCallback, useMemo, useRef, useState } from 'react';

import type { ColumnPreference, ColumnVisibility } from '../lib/table/columns.js';
import { EMPTY_COLUMN_PREFERENCE, visibleColumns } from '../lib/table/columns.js';
import type { GroupSummary, TableGroup, TableState } from '../lib/table/model.js';
import {
  EMPTY_TABLE_STATE,
  buildRowModel,
  nextSort,
  toggle,
  toggleRow,
} from '../lib/table/model.js';
import { colorForToken } from '../lib/tokens.js';
import { useViewportWidth } from './use_element_width.js';
import { Icon } from './icon.js';

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
  /** Identifica a tela nos testes e na depuração; a tabela não guarda preferência. */
  readonly screen?: string;
  readonly caption: string;
  readonly columns: readonly TableColumn<Row>[];
  readonly groups: readonly TableGroup<Row>[];
  readonly rowId: (row: Row) => string;
  readonly rowLabel: (row: Row) => string;
  readonly total?: GroupSummary | undefined;
  readonly rowsPerGroup?: number | undefined;
  readonly onOpenRow?: ((row: Row) => void) | undefined;
  /**
   * O clique simples na linha também abre (`onOpenRow`), em vez de só o duplo
   * clique e o Enter. Para a tela em que a linha é um atalho para outra página.
   */
  readonly openOnClick?: boolean | undefined;
  readonly onNewTransaction?: ((row: Row) => void) | undefined;
  readonly onEditRow?: ((row: Row) => void) | undefined;
  readonly rowActions?: ((row: Row) => React.ReactNode) | undefined;
  /**
   * O detalhe que aparece abaixo da linha quando ela é aberta. Clicar na linha
   * abre e fecha; é o que permite ver o ativo sem sair da tela.
   */
  readonly renderExpansion?: ((row: Row) => React.ReactNode) | undefined;
  readonly emptyState?: React.ReactNode;
  /**
   * Linha desabilitada: esmaecida, sem abrir nem menu, e sempre no fim do grupo.
   * É a posição encerrada, que aparece na tabela mas não se opera.
   */
  readonly isRowDisabled?: ((row: Row) => boolean) | undefined;
  /** Largura imposta, para teste e para a comparação visual. */
  readonly width?: number | undefined;
};

const alignClass = (numeric: boolean): string => (numeric ? 'text-right' : 'text-left');

const SORT_GLYPH = { asc: '↑', desc: '↓' } as const;

const HEADER_TYPOGRAPHY =
  'tabular text-label font-medium tracking-[0.06em] whitespace-nowrap text-ink-3 uppercase';

export const DataTable = <Row,>({
  caption,
  columns,
  groups,
  rowId,
  rowLabel,
  total,
  rowsPerGroup,
  onOpenRow,
  openOnClick = false,
  onNewTransaction,
  onEditRow,
  rowActions,
  renderExpansion,
  emptyState,
  isRowDisabled,
  width: forcedWidth,
}: DataTableProps<Row>): React.ReactElement => {
  const container = useRef<HTMLDivElement>(null);
  // A etapa de largura é da tela, não deste elemento: a prancha 18 as define
  // como consulta de mídia, e `useViewportWidth` explica por que importa.
  const measured = useViewportWidth(1440);
  const width = forcedWidth ?? measured;

  // A prancha não tem escolha de colunas: quem decide o que cabe é a largura.
  const preference: ColumnPreference = EMPTY_COLUMN_PREFERENCE;
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
        expandable: renderExpansion !== undefined,
        ...(isRowDisabled === undefined ? {} : { pinLast: isRowDisabled }),
      }),
    [
      groups,
      state,
      rowId,
      sortValueOf,
      isNumericColumn,
      total,
      rowsPerGroup,
      renderExpansion,
      isRowDisabled,
    ],
  );

  const dataRows = useMemo(
    () =>
      model.filter(
        (entry) => entry.kind === 'row' && isRowDisabled?.(entry.row) !== true,
      ),
    [model, isRowDisabled],
  );

  const onSort = (columnId: string): void =>
    setState((current) => ({ ...current, sort: nextSort(current.sort, columnId) }));

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
                className={`px-3 py-[9px] ${alignClass(column.numeric === true)}`}
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
            {rowActions === undefined ? null : <th className="w-11" />}
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
                <tr key={entry.id} className="border-b border-line bg-panel-2">
                  {shown.map((column, index) => (
                    <td
                      key={column.id}
                      className={`py-(--row-pad) px-3 font-semibold ${alignClass(
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
                            <Icon
                              name={entry.collapsed ? 'chevron-right' : 'chevron-down'}
                            />
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
                    className="py-(--row-pad) px-3"
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
                <tr key={entry.id} className="border-t border-line-2 font-semibold">
                  {shown.map((column, index) => (
                    <td
                      key={column.id}
                      className={`py-(--row-pad) px-3 ${alignClass(
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

            if (entry.kind === 'expansion') {
              return (
                <tr key={entry.id} className="border-b border-line bg-panel-2">
                  <td
                    colSpan={shown.length + (rowActions === undefined ? 0 : 1)}
                    className="px-3 py-3"
                  >
                    {renderExpansion?.(entry.row)}
                  </td>
                </tr>
              );
            }

            const disabled = isRowDisabled?.(entry.row) === true;
            const selected = !disabled && state.selectedRowId === entry.id;
            const expanded = state.expandedRowId === entry.id;

            return (
              <tr
                key={entry.id}
                data-row-id={entry.id}
                tabIndex={disabled ? -1 : 0}
                aria-selected={selected}
                aria-disabled={disabled || undefined}
                aria-label={rowLabel(entry.row)}
                {...(renderExpansion === undefined ? {} : { 'aria-expanded': expanded })}
                className={`group border-b border-line outline-offset-[-2px] ${
                  disabled
                    ? 'cursor-not-allowed opacity-55'
                    : selected
                      ? 'bg-accent-soft'
                      : 'hover:bg-panel-2'
                } ${
                  !disabled && (openOnClick || renderExpansion !== undefined)
                    ? 'cursor-pointer'
                    : ''
                }`}
                onFocus={() => {
                  if (disabled) return;
                  setState((current) => ({ ...current, selectedRowId: entry.id }));
                }}
                onClick={() => {
                  if (disabled) return;
                  setState((current) => ({
                    ...current,
                    selectedRowId: entry.id,
                    expandedRowId:
                      renderExpansion === undefined
                        ? current.expandedRowId
                        : toggleRow(current.expandedRowId, entry.id),
                  }));
                  if (openOnClick) onOpenRow?.(entry.row);
                }}
                onDoubleClick={() => {
                  if (!disabled) onOpenRow?.(entry.row);
                }}
                onKeyDown={(event) => {
                  if (!disabled) onRowKeyDown(event, entry.row);
                }}
              >
                {shown.map((column) => (
                  <td
                    key={column.id}
                    className={`py-(--row-pad) px-3 ${alignClass(
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
                {rowActions === undefined ? null : disabled ? (
                  <td className="px-1.5 py-1" />
                ) : (
                  // O clique no menu da linha não é clique na linha: sem isto,
                  // abrir o menu abriria também o detalhe embaixo.
                  <td
                    className="px-1.5 py-1"
                    onClick={(event) => event.stopPropagation()}
                  >
                    {rowActions(entry.row)}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
