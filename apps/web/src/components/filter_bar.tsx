import { useMemo, useState } from 'react';

import { colorForToken } from '../lib/tokens.js';
import { Icon } from './icon.js';
import type { IconName } from './icon.js';
import { Kbd } from './primitives.js';
import { Checkbox } from './ui/checkbox.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu.js';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover.js';

/**
 * D-07 · A barra de filtros e de exibição (prancha 05B).
 *
 * Uma lista tem três controles: a busca por texto, `Filtrar` e `Exibição`.
 * Cada filtro aplicado vira uma etiqueta com campo, operador e valor, editável
 * no próprio lugar; o `+` ao lado delas e o botão `Filtrar` abrem a mesma lista
 * de campos. Agrupamento, ordenação e colunas moram em `Exibição`, fora da
 * barra.
 *
 * A barra não guarda estado de filtro: cada campo traz o que está escolhido e
 * a função que muda isso, e a tela escreve na URL, como sempre.
 */

export type FilterOption = {
  readonly id: string;
  readonly label: string;
  readonly count?: number | undefined;
  readonly colorToken?: string | null | undefined;
};

type FieldBase = {
  readonly id: string;
  readonly label: string;
  readonly icon: IconName;
};

/** Um campo com lista de valores: qualquer um dos escolhidos vale. */
export type MultiFilterField = FieldBase & {
  readonly kind?: 'multi';
  readonly options: readonly FilterOption[];
  readonly selected: readonly string[];
  readonly onChange: (ids: readonly string[]) => void;
};

/** Um campo com seletor próprio, como o intervalo de datas. */
export type CustomFilterField = FieldBase & {
  readonly kind: 'custom';
  /** O que a etiqueta mostra; `null` é "sem filtro neste campo". */
  readonly value: string | null;
  readonly onClear: () => void;
  readonly content: (close: () => void) => React.ReactNode;
};

export type FilterField = MultiFilterField | CustomFilterField;

const isActive = (field: FilterField): boolean =>
  field.kind === 'custom' ? field.value !== null : field.selected.length > 0;

const SEARCH_FROM = 8;

/* -------------------------------------------------------------------------- */

const CHIP_SEGMENT = 'inline-flex h-full items-center gap-1.5 px-[9px] whitespace-nowrap';

const FilterChip = ({ field }: { readonly field: FilterField }): React.ReactElement => {
  const [open, setOpen] = useState(false);

  const chosen =
    field.kind === 'custom'
      ? []
      : field.options.filter((option) => field.selected.includes(option.id));
  const first = chosen[0];
  const operator = chosen.length > 1 ? 'é qualquer de' : 'é';

  const clear = (): void => {
    if (field.kind === 'custom') field.onClear();
    else field.onChange([]);
  };

  return (
    <span className="inline-flex h-7 items-stretch overflow-hidden rounded-lg border border-line-2 bg-panel text-[0.78125rem] font-medium text-ink">
      <span className={CHIP_SEGMENT}>
        <span aria-hidden="true" className="text-ink-3">
          <Icon name={field.icon} size={14} />
        </span>
        {field.label}
      </span>
      <span className={`${CHIP_SEGMENT} border-l border-line font-normal text-ink-3`}>
        {operator}
      </span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={`Editar filtro ${field.label}`}
            className={`${CHIP_SEGMENT} cursor-pointer border-l border-line hover:bg-panel-2`}
          >
            {field.kind === 'custom' ? (
              <span className="tabular">{field.value}</span>
            ) : (
              <>
                {first?.colorToken === undefined || first.colorToken === null ? null : (
                  <span
                    aria-hidden="true"
                    className="size-2 shrink-0 rounded-xs"
                    style={{ backgroundColor: colorForToken(first.colorToken) }}
                  />
                )}
                {first?.label ?? ''}
                {chosen.length > 1 ? ` +${chosen.length - 1}` : ''}
              </>
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent
          role="dialog"
          aria-label={`Valores de ${field.label}`}
          collisionPadding={16}
          className="overflow-hidden"
        >
          {field.kind === 'custom' ? (
            field.content(() => setOpen(false))
          ) : (
            <ValueList field={field} />
          )}
        </PopoverContent>
      </Popover>
      <button
        type="button"
        aria-label={`Remover filtro ${field.label}`}
        className="inline-flex cursor-pointer items-center border-l border-line px-[7px] text-ink-3 hover:text-ink"
        onClick={clear}
      >
        <Icon name="close" size={13} />
      </button>
    </span>
  );
};

/* -------------------------------------------------------------------------- */

/** Os valores de um campo: caixa de marcar, cor, nome e quantos itens traz. */
const ValueList = ({
  field,
}: {
  readonly field: MultiFilterField;
}): React.ReactElement => {
  const [query, setQuery] = useState('');

  const visible = useMemo(() => {
    const text = query.trim().toLowerCase();
    return text === ''
      ? field.options
      : field.options.filter((option) => option.label.toLowerCase().includes(text));
  }, [field.options, query]);

  const toggle = (id: string): void =>
    field.onChange(
      field.selected.includes(id)
        ? field.selected.filter((item) => item !== id)
        : [...field.selected, id],
    );

  return (
    <div className="w-64">
      {field.options.length >= SEARCH_FROM ? (
        <label className="flex h-9 cursor-text items-center border-b border-line px-3">
          <input
            aria-label={`Buscar ${field.label.toLowerCase()}`}
            placeholder={`${field.label}…`}
            value={query}
            autoComplete="off"
            className="min-w-0 flex-1 bg-transparent text-[0.8125rem] text-ink outline-none placeholder:text-ink-3"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      ) : (
        <p className="border-b border-line px-3 py-2 text-[0.8125rem] text-ink-3">
          {field.label}…
        </p>
      )}

      <ul className="max-h-72 overflow-y-auto p-1" role="group" aria-label={field.label}>
        {visible.length === 0 ? (
          <li className="px-3 py-2 text-[0.8125rem] text-ink-3">Nada encontrado.</li>
        ) : null}
        {visible.map((option) => (
          <li key={option.id}>
            <label className="flex cursor-pointer items-center gap-2.5 rounded-[5px] px-2.5 py-2 text-[0.8125rem] hover:bg-panel-2">
              <Checkbox
                checked={field.selected.includes(option.id)}
                onCheckedChange={() => toggle(option.id)}
              />
              {option.colorToken === undefined || option.colorToken === null ? null : (
                <span
                  aria-hidden="true"
                  className="size-2 shrink-0 rounded-xs"
                  style={{ backgroundColor: colorForToken(option.colorToken) }}
                />
              )}
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
              {option.count === undefined ? null : (
                <span className="tabular text-xs text-ink-3">{option.count}</span>
              )}
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
};

/**
 * `Adicionar filtro…`: a lista de campos e, escolhido um, os valores dele.
 * Digitar filtra os campos.
 */
const AddFilterPanel = ({
  fields,
  onDone,
}: {
  readonly fields: readonly FilterField[];
  readonly onDone: () => void;
}): React.ReactElement => {
  const [stage, setStage] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const chosen = fields.find((field) => field.id === stage);

  if (chosen !== undefined) {
    return (
      <div>
        <button
          type="button"
          className="flex w-full cursor-pointer items-center gap-2 border-b border-line px-3 py-2 text-left text-xs text-ink-3 hover:text-ink"
          onClick={() => setStage(null)}
        >
          <Icon name="chevron-left" size={12} />
          {chosen.label}
        </button>
        {chosen.kind === 'custom' ? chosen.content(onDone) : <ValueList field={chosen} />}
      </div>
    );
  }

  const text = query.trim().toLowerCase();
  const visible =
    text === ''
      ? fields
      : fields.filter((field) => field.label.toLowerCase().includes(text));

  return (
    <div className="w-56">
      <label className="flex h-9 cursor-text items-center justify-between gap-2 border-b border-line px-3">
        <input
          aria-label="Adicionar filtro"
          placeholder="Adicionar filtro…"
          value={query}
          autoComplete="off"
          className="min-w-0 flex-1 bg-transparent text-[0.8125rem] text-ink outline-none placeholder:text-ink-3"
          onChange={(event) => setQuery(event.target.value)}
        />
        <Kbd>F</Kbd>
      </label>
      <ul className="p-1" role="menu" aria-label="Campos">
        {visible.length === 0 ? (
          <li className="px-3 py-2 text-[0.8125rem] text-ink-3">Nada encontrado.</li>
        ) : null}
        {visible.map((field) => (
          <li key={field.id} role="none">
            <button
              type="button"
              role="menuitem"
              className="flex w-full cursor-pointer items-center gap-2.5 rounded-[5px] px-2.5 py-2 text-left text-[0.8125rem] hover:bg-panel-2"
              onClick={() => setStage(field.id)}
            >
              <span aria-hidden="true" className="text-ink-3">
                <Icon name={field.icon} size={14} />
              </span>
              <span className="flex-1">{field.label}</span>
              <span aria-hidden="true" className="text-ink-3">
                <Icon name="chevron-right" size={12} />
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};

/* -------------------------------------------------------------------------- */

export type DisplayChoice = {
  readonly label: string;
  readonly value: string;
  readonly options: readonly { readonly value: string; readonly label: string }[];
  readonly onChange: (value: string) => void;
};

export type DisplayColumn = {
  readonly id: string;
  readonly label: string;
  /** Essencial não se esconde: sem ela a linha não se identifica. */
  readonly locked?: boolean | undefined;
  readonly hidden: boolean;
};

export type DisplayConfig = {
  readonly groupBy?: DisplayChoice | undefined;
  readonly sortBy?: DisplayChoice | undefined;
  readonly columns?: readonly DisplayColumn[] | undefined;
  readonly onToggleColumn?: ((columnId: string) => void) | undefined;
};

const SelectButton = ({
  label,
  choice,
}: {
  readonly label: string;
  readonly choice: DisplayChoice;
}): React.ReactElement => (
  <DropdownMenu modal={false}>
    <DropdownMenuTrigger asChild>
      <button
        type="button"
        aria-label={label}
        className="inline-flex h-[30px] min-w-32 cursor-pointer items-center justify-between gap-2 rounded-control border border-line-2 bg-panel px-[11px] text-[0.78125rem] font-medium text-ink outline-none hover:bg-panel-2 focus-visible:ring-2 focus-visible:ring-focus/40"
      >
        {choice.options.find((option) => option.value === choice.value)?.label ??
          choice.value}
        <span aria-hidden="true" className="text-ink-3">
          <Icon name="chevron-down" />
        </span>
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent aria-label={label} align="end">
      {choice.options.map((option) => (
        <DropdownMenuItem
          key={option.value}
          onSelect={() => choice.onChange(option.value)}
        >
          <span className="flex min-w-0 items-center gap-2.5">
            <span aria-hidden="true" className="w-3.5 text-accent">
              {option.value === choice.value ? <Icon name="check" size={14} /> : null}
            </span>
            {option.label}
          </span>
        </DropdownMenuItem>
      ))}
    </DropdownMenuContent>
  </DropdownMenu>
);

const DisplayPanel = ({
  display,
}: {
  readonly display: DisplayConfig;
}): React.ReactElement => (
  <div className="flex w-[330px] max-w-full flex-col gap-1 p-3.5">
    {display.groupBy === undefined ? null : (
      <div className="flex min-h-[34px] items-center justify-between gap-4 text-[0.8125rem] text-ink-2">
        <span>Agrupar por</span>
        <SelectButton label="Agrupar por" choice={display.groupBy} />
      </div>
    )}
    {display.sortBy === undefined ? null : (
      <div className="flex min-h-[34px] items-center justify-between gap-4 text-[0.8125rem] text-ink-2">
        <span>Ordenar por</span>
        <SelectButton label="Ordenar por" choice={display.sortBy} />
      </div>
    )}

    {display.columns === undefined || display.columns.length === 0 ? null : (
      <>
        <hr className="my-1.5 border-line" />
        <p className="mt-1 mb-1.5 text-xs font-medium text-ink-3">Colunas visíveis</p>
        <ul className="flex flex-wrap gap-1.5" aria-label="Colunas visíveis">
          {display.columns
            .filter((column) => column.locked !== true)
            .map((column) => (
              <li key={column.id}>
                <button
                  type="button"
                  aria-pressed={!column.hidden}
                  className={`inline-flex h-7 cursor-pointer items-center rounded-[14px] border px-[11px] text-[0.78125rem] font-medium ${
                    column.hidden
                      ? 'border-line text-ink-3 hover:text-ink'
                      : 'border-line-2 bg-panel-2 text-ink'
                  }`}
                  onClick={() => display.onToggleColumn?.(column.id)}
                >
                  {column.label}
                </button>
              </li>
            ))}
        </ul>
      </>
    )}
  </div>
);

/* -------------------------------------------------------------------------- */

const TOOLBAR_BUTTON =
  'inline-flex h-[30px] cursor-pointer items-center gap-2 rounded-control border border-line-2 bg-panel px-[11px] text-[0.78125rem] font-medium text-ink outline-none hover:bg-panel-2 focus-visible:ring-2 focus-visible:ring-focus/40 data-[state=open]:bg-panel-2';

export type FilterBarProps = {
  /** A busca por texto, à esquerda; ver `ToolbarSearch`. */
  readonly search: React.ReactNode;
  readonly fields: readonly FilterField[];
  readonly display?: DisplayConfig | undefined;
  /** Os botões depois de Exibição: exportar. */
  readonly actions?: React.ReactNode;
  /** Controlado pela tela para o atalho `F`; ausente, a barra cuida sozinha. */
  readonly open?: boolean | undefined;
  readonly onOpenChange?: ((open: boolean) => void) | undefined;
  /** Remove todos os filtros, inclusive os que a barra não conhece (a busca). */
  readonly extraCount?: number | undefined;
};

export const FilterBar = ({
  search,
  fields,
  display,
  actions,
  open,
  onOpenChange,
  extraCount = 0,
}: FilterBarProps): React.ReactElement => {
  const [innerOpen, setInnerOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  const filterOpen = open ?? innerOpen;
  const setFilterOpen = (next: boolean): void => {
    setInnerOpen(next);
    onOpenChange?.(next);
  };

  const active = fields.filter(isActive);
  const count = active.length + extraCount;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-line px-4 py-2.5">
        {search}

        <div className="flex items-center gap-1.5">
          <Popover open={filterOpen} onOpenChange={setFilterOpen}>
            <PopoverTrigger asChild>
              <button type="button" aria-label="Filtrar" className={TOOLBAR_BUTTON}>
                <Icon name="filter" />
                Filtrar
                {count === 0 ? null : (
                  <span className="tabular rounded-[9px] bg-accent px-[5px] text-[0.65625rem] leading-[15px] text-btn-ink">
                    {count}
                  </span>
                )}
                <Kbd>F</Kbd>
              </button>
            </PopoverTrigger>
            <PopoverContent
              role="dialog"
              aria-label="Adicionar filtro"
              collisionPadding={16}
              align="end"
              className="overflow-hidden"
            >
              <AddFilterPanel fields={fields} onDone={() => setFilterOpen(false)} />
            </PopoverContent>
          </Popover>

          {display === undefined ? null : (
            <Popover>
              <PopoverTrigger asChild>
                <button type="button" className={TOOLBAR_BUTTON}>
                  <Icon name="sliders" />
                  Exibição
                </button>
              </PopoverTrigger>
              <PopoverContent
                role="dialog"
                aria-label="Exibição"
                collisionPadding={16}
                align="end"
              >
                <DisplayPanel display={display} />
              </PopoverContent>
            </Popover>
          )}

          {actions}
        </div>
      </div>

      {active.length === 0 ? null : (
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-[9px]">
          {active.map((field) => (
            <FilterChip key={field.id} field={field} />
          ))}
          <Popover open={addOpen} onOpenChange={setAddOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label="Adicionar filtro"
                className="inline-flex size-7 cursor-pointer items-center justify-center rounded-control text-ink-3 hover:bg-panel-2 hover:text-ink"
              >
                <Icon name="plus" />
              </button>
            </PopoverTrigger>
            <PopoverContent
              role="dialog"
              aria-label="Adicionar filtro"
              collisionPadding={16}
              className="overflow-hidden"
            >
              <AddFilterPanel fields={fields} onDone={() => setAddOpen(false)} />
            </PopoverContent>
          </Popover>
        </div>
      )}
    </>
  );
};

/** A busca por texto da barra: lupa e campo, sem caixa (prancha 13). */
export const ToolbarSearch = ({
  value,
  onChange,
  label,
  placeholder,
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly label: string;
  readonly placeholder: string;
}): React.ReactElement => (
  <label className="flex h-[30px] min-w-0 cursor-text items-center gap-2 text-ink-3">
    <Icon name="search" />
    <input
      type="search"
      value={value}
      aria-label={label}
      placeholder={placeholder}
      autoComplete="off"
      className="w-52 min-w-0 bg-transparent text-[0.8125rem] text-ink outline-none placeholder:text-ink-3 [&::-webkit-search-cancel-button]:hidden"
      onChange={(event) => onChange(event.target.value)}
    />
  </label>
);

/** O botão de ícone depois de Exibição: exportar CSV. */
export const ToolbarIconButton = ({
  label,
  icon,
  disabled,
  onClick,
}: {
  readonly label: string;
  readonly icon: IconName;
  readonly disabled?: boolean | undefined;
  readonly onClick: () => void;
}): React.ReactElement => (
  <button
    type="button"
    aria-label={label}
    title={label}
    disabled={disabled}
    className="inline-flex h-[30px] w-[30px] cursor-pointer items-center justify-center rounded-control border border-line-2 bg-panel text-ink outline-none hover:bg-panel-2 focus-visible:ring-2 focus-visible:ring-focus/40 disabled:cursor-not-allowed disabled:opacity-50"
    onClick={onClick}
  >
    <Icon name={icon} />
  </button>
);
