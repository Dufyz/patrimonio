import { useId, useMemo, useRef, useState } from 'react';

import { Compact } from './number.js';
import { SearchInput } from './primitives.js';
import { useDismiss } from './use_dismiss.js';
import { Icon } from './icon.js';

/**
 * D-12 · Seletor com busca.
 *
 * O mesmo componente serve ativo, carteira, instituição e categoria. A busca só
 * aparece a partir de seis opções, como a prancha 16 define: com quatro
 * carteiras, um campo de filtro é um obstáculo entre o clique e a escolha.
 *
 * A navegação é por teclado do começo ao fim — seta anda, Enter escolhe, Esc
 * fecha — porque lançar uma compra sem tirar a mão do teclado é o caso de uso
 * que decide se a aplicação é usada todo dia ou uma vez por mês.
 */

export const SEARCH_THRESHOLD = 6;

export type SelectOption = {
  readonly id: string;
  readonly label: string;
  readonly hint?: string | undefined;
  /** Valor à direita, em forma compacta. */
  readonly value?: string | null | undefined;
};

export type SearchSelectProps = {
  readonly label: string;
  readonly options: readonly SelectOption[];
  readonly value: string | null;
  readonly onChange: (id: string) => void;
  readonly placeholder?: string;
  readonly emptyLabel?: string;
  /**
   * Na barra de uma tela, o gatilho mostra ícone e rótulo ("≡ Carteira
   * Emergência") e tem a largura do conteúdo, como na prancha 1.3.
   */
  readonly toolbar?:
    { readonly icon: React.ComponentProps<typeof Icon>['name'] } | undefined;
  /** Uma nota no pé da lista ("Vale só para esta tela..."). */
  readonly note?: string | undefined;
  /** Já abre com a lista à mostra: a edição em linha de uma célula. */
  readonly defaultOpen?: boolean | undefined;
  /** Fechou sem escolher (Esc ou clique fora). */
  readonly onDismiss?: (() => void) | undefined;
};

const matches = (option: SelectOption, query: string): boolean => {
  const needle = query.trim().toLowerCase();
  if (needle === '') return true;
  return (
    option.label.toLowerCase().includes(needle) ||
    (option.hint ?? '').toLowerCase().includes(needle)
  );
};

export const SearchSelect = ({
  label,
  options,
  value,
  onChange,
  placeholder = 'Filtrar',
  emptyLabel = 'Nada encontrado',
  toolbar,
  note,
  defaultOpen = false,
  onDismiss,
}: SearchSelectProps): React.ReactElement => {
  const [open, setOpen] = useState(defaultOpen);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const listId = useId();

  const close = (): void => {
    setOpen(false);
    setQuery('');
    trigger.current?.focus();
  };

  useDismiss(container, open, () => {
    close();
    onDismiss?.();
  });

  const filtered = useMemo(
    () => options.filter((option) => matches(option, query)),
    [options, query],
  );

  const selected = options.find((option) => option.id === value) ?? null;
  const withSearch = options.length >= SEARCH_THRESHOLD;

  const choose = (id: string): void => {
    onChange(id);
    close();
  };

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((current) => Math.min(current + 1, filtered.length - 1));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((current) => Math.max(current - 1, 0));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const option = filtered[active];
      if (option !== undefined) choose(option.id);
    }
  };

  return (
    <div ref={container} className="relative">
      {toolbar === undefined ? (
        <button
          ref={trigger}
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={label}
          className="flex h-control w-full cursor-pointer items-center justify-between gap-2 rounded-control border border-line bg-panel px-3 text-sm"
          onClick={() => {
            setOpen((current) => !current);
            setActive(0);
          }}
        >
          <span className="truncate">{selected?.label ?? placeholder}</span>
          <span aria-hidden="true" className="text-ink-3">
            <Icon name="chevron-down" />
          </span>
        </button>
      ) : (
        <button
          ref={trigger}
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={`${label}: ${selected?.label ?? placeholder}`}
          className="flex h-control cursor-pointer items-center gap-2 rounded-control border border-line bg-panel px-3 text-[0.8125rem] hover:bg-panel-2"
          onClick={() => {
            setOpen((current) => !current);
            setActive(0);
          }}
        >
          <span aria-hidden="true" className="text-ink-2">
            <Icon name={toolbar.icon} />
          </span>
          <span className="text-ink-3">{label}</span>
          <span className="font-semibold">{selected?.label ?? placeholder}</span>
          <span aria-hidden="true" className="text-ink-3">
            <Icon name="chevron-down" />
          </span>
        </button>
      )}

      {open ? (
        <div
          className={`absolute top-[calc(var(--spacing-control)+0.25rem)] z-30 rounded-panel border border-line bg-panel p-1 shadow-lg ${
            toolbar === undefined ? 'right-0 left-0' : 'left-0 w-64'
          }`}
          onKeyDown={onKeyDown}
        >
          {withSearch ? (
            <SearchInput
              inline
              autoFocus
              value={query}
              placeholder={placeholder}
              label={`${label}: filtrar`}
              aria-controls={listId}
              onChange={(next) => {
                setQuery(next);
                setActive(0);
              }}
            />
          ) : null}

          <ul
            id={listId}
            role="listbox"
            aria-label={label}
            className="max-h-64 overflow-y-auto"
          >
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-sm text-ink-3">{emptyLabel}</li>
            ) : null}

            {filtered.map((option, index) => (
              <li key={option.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={option.id === value}
                  tabIndex={-1}
                  className={`flex w-full cursor-pointer items-center justify-between gap-3 rounded-control px-3 py-1.5 text-left text-sm ${
                    option.id === value
                      ? 'bg-accent-soft font-semibold text-accent'
                      : index === active
                        ? 'bg-panel-2'
                        : ''
                  }`}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => choose(option.id)}
                >
                  <span className="min-w-0">
                    <span className="block truncate">{option.label}</span>
                    {option.hint === undefined ? null : (
                      <span className="block truncate text-[0.75rem] text-ink-3">
                        {option.hint}
                      </span>
                    )}
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {option.value === undefined ? null : <Compact value={option.value} />}
                    {option.id === value ? (
                      <span aria-hidden="true" className="text-accent">
                        <Icon name="check" />
                      </span>
                    ) : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {note === undefined ? null : (
            <p className="mt-1 border-t border-line px-3 pt-2 pb-1.5 text-xs text-ink-3">
              {note}
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
};
