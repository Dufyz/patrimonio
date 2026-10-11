import { Icon } from '../../components/icon.js';
import { useId, useMemo, useRef, useState } from 'react';

import { useDismiss } from '../../components/use_dismiss.js';
import type { ControlProps } from './fields.js';
import { Input } from './fields.js';

/**
 * A instituição do lançamento.
 *
 * O catálogo brasileiro tem centenas de linhas, então a escolha é uma busca, e
 * não uma lista. A pessoa só escolhe: o catálogo vem da carga, e não se cria
 * instituição por aqui.
 *
 * Como no ativo, o campo não guarda texto solto: digitar desfaz a escolha, e o
 * formulário só vale de novo quando uma instituição da lista é escolhida.
 */

export type InstitutionOption = { readonly id: string; readonly name: string };

const MAX_ITEMS = 50;

const fold = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();

export const InstitutionPicker = ({
  options,
  value,
  onChange,
  onBlur,
  control,
  invalid,
  changed = false,
}: {
  readonly options: readonly InstitutionOption[];
  readonly value: string | null;
  readonly onChange: (id: string | null) => void;
  readonly onBlur?: () => void;
  readonly control: ControlProps;
  readonly invalid: boolean;
  readonly changed?: boolean;
}): React.ReactElement => {
  const selected = options.find((option) => option.id === value) ?? null;

  const [query, setQuery] = useState(selected?.name ?? '');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const container = useRef<HTMLDivElement>(null);
  const listId = useId();

  useDismiss(container, open, () => setOpen(false));

  const needle = fold(query.trim());

  const items = useMemo(
    () =>
      options
        .filter((option) => needle === '' || fold(option.name).includes(needle))
        .slice(0, MAX_ITEMS),
    [options, needle],
  );

  const showList = open && value === null;

  const choose = (option: InstitutionOption): void => {
    setQuery(option.name);
    setOpen(false);
    onChange(option.id);
  };

  return (
    <div ref={container} className="relative">
      <Input
        {...control}
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        className="pl-9"
        invalid={invalid}
        changed={changed}
        value={query}
        placeholder="Buscar instituição"
        {...(onBlur === undefined ? {} : { onBlur })}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          setActive(0);
          if (value !== null) onChange(null);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActive((current) => Math.min(current + 1, items.length - 1));
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActive((current) => Math.max(current - 1, 0));
          } else if (event.key === 'Enter' && showList) {
            const option = items[active];
            event.preventDefault();
            event.stopPropagation();
            if (option !== undefined) choose(option);
          }
        }}
      />

      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-0 left-3 flex h-[38px] items-center text-ink-3"
      >
        <Icon name="search" />
      </span>

      {showList ? (
        <ul
          id={listId}
          role="listbox"
          aria-label="Instituições encontradas"
          className="absolute top-[calc(var(--spacing-control)+0.25rem)] right-0 left-0 z-30 max-h-64 overflow-y-auto rounded-panel border border-line bg-panel py-1 shadow-lg"
        >
          {items.length === 0 ? (
            <li className="px-3 py-2 text-sm text-ink-3">Nenhuma instituição encontrada.</li>
          ) : null}

          {items.map((option, index) => (
            <li key={option.id} role="presentation">
              <button
                type="button"
                role="option"
                aria-selected={index === active}
                tabIndex={-1}
                className={`flex w-full cursor-pointer items-center px-3 py-1.5 text-left text-sm ${
                  index === active ? 'bg-panel-2' : ''
                }`}
                onMouseEnter={() => setActive(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(option)}
              >
                <span className="truncate">{option.name}</span>
              </button>
            </li>
          ))}

        </ul>
      ) : null}
    </div>
  );
};
