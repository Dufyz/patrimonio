import { useMemo, useState } from 'react';

import { AppliedFilters } from '../../components/controls.js';
import {
  Button,
  IconButton,
  Kbd,
  Label,
  SearchInput,
} from '../../components/primitives.js';
import { useShortcuts } from '../../components/shortcuts.js';
import { Checkbox } from '../../components/ui/checkbox.js';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover.js';
import {
  appliedChips,
  clearFilterField,
  countActiveFilters,
  toggleFilterValue,
} from '../lib/filters.js';
import type { FilterField, FilterState } from '../lib/filters.js';
import { toggleColumn } from '../lib/columns.js';
import type { ColumnSpec } from '../lib/columns.js';

/**
 * FIN-005 · A barra de ferramentas da tabela.
 *
 * A ordem é fixa em todas as telas: caixa de busca primeiro e, à direita,
 * contador da tabela, Agrupar (só em Lançamentos), Filtrar com o selo `F`,
 * Exibição e exportar. A busca filtra enquanto digita; o painel de filtros tem
 * o que a tela filtra; Exibição mostra e oculta colunas.
 */

export const TableToolbar = ({
  searchPlaceholder,
  search,
  onSearch,
  counter,
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
  /** "15 categorias", "4 lançamentos". */
  readonly counter: React.ReactNode;
  /** O seletor de agrupamento, só em Lançamentos. */
  readonly group?: React.ReactNode;
  readonly filterFields: readonly FilterField[];
  readonly filters: FilterState;
  readonly onFilters: (next: FilterState) => void;
  readonly columns: readonly ColumnSpec[];
  readonly hiddenColumns: readonly string[];
  readonly onHiddenColumns: (next: readonly string[]) => void;
  readonly onExport: () => void;
}): React.ReactElement => {
  const [filterOpen, setFilterOpen] = useState(false);
  const active = countActiveFilters(filters);

  // `F` abre os filtros, fora de campos de texto (o registro de atalhos cuida disso).
  const shortcuts = useMemo(() => ({ filter: () => setFilterOpen((open) => !open) }), []);
  useShortcuts(shortcuts);

  const chips = appliedChips(filterFields, filters);

  return (
    <div className="flex flex-col gap-2 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          className="min-w-56 flex-1"
          label={searchPlaceholder}
          placeholder={searchPlaceholder}
          value={search}
          onChange={onSearch}
        />

        <span className="tabular ml-auto text-xs whitespace-nowrap text-ink-3">
          {counter}
        </span>
        {group}

        <Popover open={filterOpen} onOpenChange={setFilterOpen}>
          <PopoverTrigger asChild>
            <Button
              icon="filter"
              aria-label={active === 0 ? 'Filtrar' : `Filtrar, ${active} ativos`}
            >
              Filtrar
              {active === 0 ? null : (
                <span className="tabular rounded-full bg-accent px-1.5 text-xs text-accent-ink">
                  {active}
                </span>
              )}
              <Kbd>F</Kbd>
            </Button>
          </PopoverTrigger>
          <PopoverContent
            role="dialog"
            aria-label="Filtros"
            align="end"
            className="flex w-72 flex-col gap-4 p-4"
          >
            {filterFields.map((field) => (
              <fieldset key={field.id} className="flex flex-col gap-1.5">
                <legend className="mb-1">
                  <Label>{field.label}</Label>
                </legend>
                {field.options.map((option) => {
                  const checked = (filters[field.id] ?? []).includes(option.value);
                  const id = `filtro-${field.id}-${option.value}`;
                  return (
                    <label
                      key={option.value}
                      htmlFor={id}
                      className="flex items-center gap-2 text-[0.8125rem]"
                    >
                      <Checkbox
                        id={id}
                        checked={checked}
                        onCheckedChange={() =>
                          onFilters(toggleFilterValue(filters, field.id, option.value))
                        }
                      />
                      {option.label}
                    </label>
                  );
                })}
              </fieldset>
            ))}
          </PopoverContent>
        </Popover>

        <Popover>
          <PopoverTrigger asChild>
            <Button icon="sliders">Exibição</Button>
          </PopoverTrigger>
          <PopoverContent
            role="dialog"
            aria-label="Exibição"
            align="end"
            className="flex w-60 flex-col gap-2 p-4"
          >
            <Label>Colunas</Label>
            {columns.map((column) => {
              const id = `coluna-${column.id}`;
              return (
                <label
                  key={column.id}
                  htmlFor={id}
                  className="flex items-center gap-2 text-[0.8125rem]"
                >
                  <Checkbox
                    id={id}
                    checked={!hiddenColumns.includes(column.id)}
                    disabled={column.locked === true}
                    onCheckedChange={() =>
                      onHiddenColumns(toggleColumn(hiddenColumns, columns, column.id))
                    }
                  />
                  {column.label}
                </label>
              );
            })}
          </PopoverContent>
        </Popover>

        <IconButton label="Exportar" icon="download" onClick={onExport} />
      </div>

      <AppliedFilters
        filters={chips.map((chip) => ({
          id: chip.id,
          label: chip.label,
          onRemove: () => onFilters(toggleFilterValue(filters, chip.field, chip.value)),
        }))}
        onClearAll={() => {
          let next = filters;
          for (const field of filterFields) next = clearFilterField(next, field.id);
          onFilters(next);
        }}
      />
    </div>
  );
};
