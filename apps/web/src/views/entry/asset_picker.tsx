import type { SearchAsset, SearchResource } from '@patrimonio/contracts';
import { useEffect, useId, useRef, useState } from 'react';

import { fetchSearch } from '../../api/search.js';
import { holdingLabel, assetName } from '../../lib/search.js';
import { useDismiss } from '../../components/use_dismiss.js';
import type { ControlProps } from './fields.js';
import { Input } from './fields.js';

/**
 * T-10 · O ativo do lançamento.
 *
 * Um campo de busca que escolhe de uma lista, como a prancha 13 desenha: o
 * código em destaque, o nome ao lado e "você tem 500" à direita. A busca é a
 * mesma da paleta (`/api/search`) — quem acha o ativo é a `api`, que compara
 * sem acento e põe primeiro o que a pessoa já tem.
 *
 * O campo não guarda texto solto: enquanto a pessoa digita, o ativo escolhido
 * é desfeito, e o formulário só vale de novo quando ela escolher um da lista.
 * Um ticker digitado e nunca escolhido seria o erro mais caro desta tela — o
 * lançamento de um papel parecido.
 */

/** O que o formulário guarda do ativo escolhido. */
export type PickedAsset = {
  readonly id: string;
  /** O código, ou o nome quando o ativo não tem um código que alguém reconheça. */
  readonly label: string;
  readonly name: string | null;
  /** "500", quando se sabe quanto a pessoa tem. */
  readonly held: string | null;
};

export const pickedFromSearch = (asset: SearchAsset): PickedAsset => ({
  id: asset.id,
  label: assetName(asset),
  name: asset.name,
  held: asset.holding?.quantity ?? null,
});

export const SEARCH_DELAY_MS = 200;

export type AssetSearch = (text: string, signal: AbortSignal) => Promise<SearchResource>;

export const AssetPicker = ({
  value,
  onChange,
  onBlur,
  control,
  invalid,
  search = fetchSearch,
  autoFocus = false,
}: {
  readonly value: PickedAsset | null;
  readonly onChange: (asset: PickedAsset | null) => void;
  readonly onBlur?: () => void;
  readonly control: ControlProps;
  readonly invalid: boolean;
  /** A busca no banco. Troca-se nos testes; a identidade precisa ser estável. */
  readonly search?: AssetSearch;
  readonly autoFocus?: boolean;
}): React.ReactElement => {
  const [query, setQuery] = useState(value?.label ?? '');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [results, setResults] = useState<readonly SearchAsset[] | null>(null);
  const [failed, setFailed] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const listId = useId();

  // Quem abriu o modal já com um ativo (a linha de Posições, a paleta) o entrega
  // pronto; o campo só acompanha.
  const valueId = value?.id ?? null;
  const valueLabel = value?.label ?? null;
  useEffect(() => {
    if (valueLabel !== null) setQuery(valueLabel);
  }, [valueId, valueLabel]);

  useDismiss(container, open, () => setOpen(false));

  const text = query.trim();
  const searching = open && value === null && text !== '';

  useEffect(() => {
    if (!searching) return;

    const controller = new AbortController();
    const timer = setTimeout(() => {
      search(text, controller.signal)
        .then((resource) => {
          if (controller.signal.aborted) return;
          setResults(resource.assets.items);
          setFailed(false);
          setActive(0);
        })
        .catch(() => {
          if (!controller.signal.aborted) setFailed(true);
        });
    }, SEARCH_DELAY_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [searching, text, search]);

  const choose = (asset: SearchAsset): void => {
    const picked = pickedFromSearch(asset);
    setQuery(picked.label);
    setOpen(false);
    onChange(picked);
  };

  const items = results ?? [];
  const showList = searching;

  return (
    <div ref={container} className="relative">
      <Input
        {...control}
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        autoFocus={autoFocus}
        invalid={invalid}
        value={query}
        placeholder="Código ou nome do ativo"
        {...(onBlur === undefined ? {} : { onBlur })}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
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
            const asset = items[active];
            // Enter escolhe o ativo marcado e não vai adiante: com a lista aberta
            // ele é da lista, não do formulário.
            if (asset !== undefined) {
              event.preventDefault();
              event.stopPropagation();
              choose(asset);
            }
          }
        }}
      />

      {value?.held === null || value === null ? null : (
        <span className="pointer-events-none absolute top-0 right-3 flex h-control items-center text-[0.75rem] text-ink-3">
          você tem <span className="tabular ml-1">{value.held}</span>
        </span>
      )}

      {showList ? (
        <ul
          id={listId}
          role="listbox"
          aria-label="Ativos encontrados"
          className="absolute top-[calc(var(--spacing-control)+0.25rem)] right-0 left-0 z-30 max-h-64 overflow-y-auto rounded-panel border border-line bg-panel py-1 shadow-lg"
        >
          {failed ? (
            <li className="px-3 py-2 text-sm text-negative">A busca não respondeu.</li>
          ) : results === null ? (
            <li className="px-3 py-2 text-sm text-ink-3">Buscando…</li>
          ) : items.length === 0 ? (
            <li className="px-3 py-2 text-sm text-ink-3">
              Nenhum ativo cadastrado com “{text}”.
            </li>
          ) : (
            items.map((asset, index) => (
              <li key={asset.id} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={index === active}
                  tabIndex={-1}
                  className={`flex w-full cursor-pointer items-center justify-between gap-3 px-3 py-1.5 text-left text-sm ${
                    index === active ? 'bg-panel-2' : ''
                  }`}
                  onMouseEnter={() => setActive(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(asset)}
                >
                  <span className="min-w-0 truncate">
                    <strong className="tabular font-semibold">{assetName(asset)}</strong>
                    {assetName(asset) === asset.name ? null : (
                      <span className="ml-2 text-ink-3">{asset.name}</span>
                    )}
                  </span>
                  <span className="shrink-0 text-[0.75rem] text-ink-3">
                    {holdingLabel(asset)}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
};
