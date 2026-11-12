import { useMemo, useState } from 'react';

import type { FilterField as BarField } from './filter_bar.js';
import { FilterBar, ToolbarIconButton, ToolbarSearch } from './filter_bar.js';
import { Icon } from './icon.js';
import type { IconName } from './icon.js';
import { useShortcuts } from './shortcuts.js';
import { toggleColumn } from '../finance/lib/columns.js';
import type { ColumnSpec } from '../finance/lib/columns.js';
import { clearFilterField, countActiveFilters } from '../finance/lib/filters.js';
import type { FilterField, FilterState } from '../finance/lib/filters.js';

/**
 * FIN-005 · A barra de ferramentas da tabela: a `FilterBar` de Investimentos
 * (prancha 05B), alimentada pelos filtros de Finanças.
 *
 * A ordem é a mesma em todas as telas: busca à esquerda e, à direita, Filtrar
 * com o selo `F`, Exibição (agrupamento e colunas) e exportar. Cada filtro
 * aplicado vira uma etiqueta editável com campo, operador e valor.
 */

const FIELD_ICONS: Readonly<Record<string, IconName>> = {
  tipo: 'tag',
  categoria: 'tag',
  conta: 'bank',
  situacao: 'pulse',
};

export const TableToolbar = ({
  searchPlaceholder,
  search,
  onSearch,
  counter,
  counterIcon,
  group,
  filterFields,
  filters,
  onFilters,
  columns,
  hiddenColumns,
  onHiddenColumns,
  onExport,
}: {
  readonly searchPlaceholder: string;
  readonly search: string;
  readonly onSearch: (value: string) => void;
  /** "15 categorias": só onde a prancha mostra o resumo na barra. */
  readonly counter?: React.ReactNode;
  /** Ícone antes do resumo, onde a prancha traz um (Recorrentes). */
  readonly counterIcon?: IconName;
  /** O seletor "Agrupar: Dia", só em Lançamentos: fica na barra, antes de Filtrar. */
  readonly group?: React.ReactNode;
  readonly filterFields: readonly FilterField[];
  readonly filters: FilterState;
  readonly onFilters: (next: FilterState) => void;
  /** Sem colunas escolhíveis (tela de cadastro com uma coluna só), some o "Exibição". */
  readonly columns?: readonly ColumnSpec[] | undefined;
  readonly hiddenColumns?: readonly string[] | undefined;
  readonly onHiddenColumns?: ((next: readonly string[]) => void) | undefined;
  readonly onExport: () => void;
}): React.ReactElement => {
  const [filterOpen, setFilterOpen] = useState(false);

  // `F` abre os filtros, fora de campos de texto (o registro de atalhos cuida disso).
  const shortcuts = useMemo(() => ({ filter: () => setFilterOpen((open) => !open) }), []);
  useShortcuts(shortcuts);

  const fields: readonly BarField[] = filterFields.map((field) => ({
    id: field.id,
    label: field.label,
    icon: FIELD_ICONS[field.id] ?? 'tag',
    options: field.options.map((option) => ({ id: option.value, label: option.label })),
    selected: filters[field.id] ?? [],
    onChange: (ids) =>
      onFilters(
        ids.length === 0
          ? clearFilterField(filters, field.id)
          : { ...filters, [field.id]: ids },
      ),
  }));

  return (
    <FilterBar
      search={
        <div className="flex min-w-0 items-center gap-4">
          <ToolbarSearch
            value={search}
            onChange={onSearch}
            label={searchPlaceholder}
            placeholder={searchPlaceholder}
          />
        </div>
      }
      fields={fields}
      beforeFilter={
        <>
          {counter === undefined ? null : (
            <span className="mr-1 inline-flex items-center gap-1.5 text-[0.8125rem] whitespace-nowrap text-ink-2">
              {counterIcon === undefined ? null : <Icon name={counterIcon} size={14} />}
              {counter}
            </span>
          )}
          {group}
        </>
      }
      open={filterOpen}
      onOpenChange={setFilterOpen}
      display={
        columns === undefined ||
        hiddenColumns === undefined ||
        onHiddenColumns === undefined
          ? undefined
          : {
              columns: columns.map((column) => ({
                id: column.id,
                label: column.label,
                locked: column.locked === true,
                hidden: hiddenColumns.includes(column.id),
              })),
              onToggleColumn: (id) =>
                onHiddenColumns(toggleColumn(hiddenColumns, columns, id)),
            }
      }
      actions={<ToolbarIconButton label="Exportar" icon="download" onClick={onExport} />}
    />
  );
};

export const activeFilterCount = countActiveFilters;
