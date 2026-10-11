import { useMemo, useState } from 'react';

import { colorForToken } from '../lib/tokens.js';
import { Icon } from './icon.js';
import { SearchInput } from './primitives.js';
import { Checkbox } from './ui/checkbox.js';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover.js';

/**
 * D-07 · Filtro em lista suspensa, de escolha múltipla.
 *
 * Um filtro por dimensão — categoria, instituição, tipo — em vez de uma fileira
 * de pastilhas: a barra mantém o mesmo tamanho com três ou com trinta opções, e
 * os filtros se somam. Dentro de um filtro, escolher várias opções vale como
 * "qualquer uma"; entre filtros diferentes, vale "todas".
 *
 * Fechado, o botão diz o que está valendo — `Categoria · Ações +1` — e ganha o
 * tom de acento; aberto, cada opção mostra quantos itens ela traz. A busca
 * dentro da lista aparece a partir de oito opções.
 */

export type FilterOption = {
  readonly id: string;
  readonly label: string;
  readonly count?: number | undefined;
  readonly colorToken?: string | null | undefined;
};

const SEARCH_FROM = 8;

export const FilterDropdown = ({
  label,
  options,
  selected,
  onChange,
}: {
  readonly label: string;
  readonly options: readonly FilterOption[];
  readonly selected: readonly string[];
  readonly onChange: (ids: readonly string[]) => void;
}): React.ReactElement => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const chosen = options.filter((option) => selected.includes(option.id));
  const active = chosen.length > 0;

  const visible = useMemo(() => {
    const text = query.trim().toLowerCase();
    return text === ''
      ? options
      : options.filter((option) => option.label.toLowerCase().includes(text));
  }, [options, query]);

  const toggle = (id: string): void =>
    onChange(
      selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id],
    );

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery('');
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          className={`inline-flex h-control max-w-64 shrink-0 cursor-pointer items-center gap-2 rounded-control border px-[11px] text-[0.78125rem] font-medium whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-focus/40 ${
            active
              ? 'border-accent bg-accent-soft text-accent'
              : 'border-line-2 bg-panel text-ink-2 hover:bg-panel-2'
          }`}
        >
          <span className="truncate">
            {active
              ? `${label} · ${chosen[0]?.label ?? ''}${chosen.length > 1 ? ` +${chosen.length - 1}` : ''}`
              : label}
          </span>
          <Icon name="chevron-down" />
        </button>
      </PopoverTrigger>

      <PopoverContent
        role="dialog"
        aria-label={`Filtrar por ${label.toLowerCase()}`}
        collisionPadding={16}
        className="w-64 overflow-hidden"
      >
        {options.length >= SEARCH_FROM ? (
          <SearchInput
            inline
            value={query}
            label={`Buscar ${label.toLowerCase()}`}
            placeholder="Filtrar"
            onChange={setQuery}
          />
        ) : null}

        <ul className="max-h-72 overflow-y-auto p-1" role="group" aria-label={label}>
          {visible.length === 0 ? (
            <li className="px-3 py-2 text-[0.8125rem] text-ink-3">Nada encontrado.</li>
          ) : null}
          {visible.map((option) => (
            <li key={option.id}>
              <label className="flex cursor-pointer items-center gap-2.5 rounded-[5px] px-2.5 py-2 text-[0.8125rem] hover:bg-panel-2">
                <Checkbox
                  checked={selected.includes(option.id)}
                  onCheckedChange={() => toggle(option.id)}
                />
                {option.colorToken === undefined ? null : (
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

        <div className="flex items-center justify-between border-t border-line px-3 py-2 text-xs text-ink-3">
          <span>
            {active
              ? `${chosen.length} ${chosen.length === 1 ? 'selecionado' : 'selecionados'}`
              : 'Nenhum filtro'}
          </span>
          <button
            type="button"
            disabled={!active}
            className="cursor-pointer font-medium text-accent hover:underline disabled:cursor-not-allowed disabled:text-ink-3 disabled:no-underline"
            onClick={() => onChange([])}
          >
            Limpar
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
};
