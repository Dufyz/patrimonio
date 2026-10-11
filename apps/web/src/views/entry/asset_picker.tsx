import type {
  SearchAsset,
  SearchInstrument,
  SearchResource,
} from '@patrimonio/contracts';
import { useEffect, useId, useMemo, useRef, useState } from 'react';

import { fetchSearch } from '../../api/search.js';
import type { NewAssetDraft } from '../../lib/entry.js';
import { INSTRUMENT_TYPE_LABELS, holdingLabel, assetName } from '../../lib/search.js';
import { useDismiss } from '../../components/use_dismiss.js';
import type { ControlProps } from './fields.js';
import { Input } from './fields.js';
import { Icon } from '../../components/icon.js';

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
  /** Nulo no papel do catálogo, que só vira ativo no lançamento. */
  readonly id: string | null;
  readonly instrument?: NewAssetDraft | null;
  /** O código, ou o nome quando o ativo não tem um código que alguém reconheça. */
  readonly label: string;
  readonly name: string | null;
  /** "500", quando se sabe quanto a pessoa tem. */
  readonly held: string | null;
};

export const pickedFromSearch = (asset: SearchAsset): PickedAsset => ({
  id: asset.id,
  instrument: null,
  label: assetName(asset),
  name: asset.name,
  held: asset.holding?.quantity ?? null,
});

export const pickedFromInstrument = (instrument: SearchInstrument): PickedAsset => ({
  id: null,
  instrument: {
    ticker: instrument.ticker,
    name: instrument.name,
    b3_type: instrument.b3_type,
  },
  label: instrument.ticker,
  name: instrument.name,
  held: null,
});

export const CATALOG_EMPTY_MESSAGE =
  'O catálogo de papéis está vazio: a carga inicial não foi executada. ' +
  'Rode pnpm seed:instruments e busque de novo.';

export const SEARCH_DELAY_MS = 200;

type Option =
  | { readonly kind: 'asset'; readonly key: string; readonly asset: SearchAsset }
  | {
      readonly kind: 'instrument';
      readonly key: string;
      readonly instrument: SearchInstrument;
    };

type Found = {
  readonly options: readonly Option[];
  readonly catalogEmpty: boolean;
  readonly unavailable: boolean;
};

const optionsOf = (resource: SearchResource, allowNew: boolean): Found => ({
  options: [
    ...resource.assets.items.map((asset): Option => ({
      kind: 'asset',
      key: `asset:${asset.id}`,
      asset,
    })),
    ...(allowNew
      ? resource.instruments.items.map((instrument): Option => ({
          kind: 'instrument',
          key: `instrument:${instrument.ticker}`,
          instrument,
        }))
      : []),
  ],
  catalogEmpty: allowNew && resource.instruments.catalog_empty,
  unavailable: allowNew && resource.instruments.fallback === 'unavailable',
});

export type AssetSearch = (text: string, signal: AbortSignal) => Promise<SearchResource>;

export const AssetPicker = ({
  value,
  onChange,
  onBlur,
  control,
  invalid,
  portfolioId,
  search,
  autoFocus = false,
  allowNew = true,
}: {
  readonly value: PickedAsset | null;
  readonly onChange: (asset: PickedAsset | null) => void;
  readonly onBlur?: () => void;
  readonly control: ControlProps;
  readonly invalid: boolean;
  /** A carteira em que o lançamento vai: é nela que a busca mede o que a pessoa tem. */
  readonly portfolioId: string | null;
  /** A busca no banco. Troca-se nos testes; a identidade precisa ser estável. */
  readonly search?: AssetSearch;
  readonly autoFocus?: boolean;
  /**
   * Oferece os papéis do mercado que a pessoa ainda não tem. O provento não:
   * ele só existe para um ativo que já tem posição.
   */
  readonly allowNew?: boolean;
}): React.ReactElement => {
  const [query, setQuery] = useState(value?.label ?? '');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [results, setResults] = useState<Found | null>(null);
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
  const run = useMemo<AssetSearch | null>(
    () =>
      search ??
      (portfolioId === null
        ? null
        : (query, signal) => fetchSearch(query, portfolioId, signal)),
    [search, portfolioId],
  );
  const searching = open && value === null && text !== '' && run !== null;

  useEffect(() => {
    if (!searching || run === null) return;

    const controller = new AbortController();
    const timer = setTimeout(() => {
      run(text, controller.signal)
        .then((resource) => {
          if (controller.signal.aborted) return;
          setResults(optionsOf(resource, allowNew));
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
  }, [searching, text, run, allowNew]);

  const choose = (option: Option): void => {
    const picked =
      option.kind === 'asset'
        ? pickedFromSearch(option.asset)
        : pickedFromInstrument(option.instrument);
    setQuery(picked.label);
    setOpen(false);
    onChange(picked);
  };

  const items = results?.options ?? [];
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
        className="pl-9 font-semibold"
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
            const option = items[active];
            // Enter escolhe o ativo marcado e não vai adiante: com a lista aberta
            // ele é da lista, não do formulário.
            if (option !== undefined) {
              event.preventDefault();
              event.stopPropagation();
              choose(option);
            }
          }
        }}
      />

      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-0 left-3 flex h-[38px] items-center text-ink-3"
      >
        <Icon name="search" />
      </span>

      {value === null ? null : (
        <span className="pointer-events-none absolute top-0 right-3 flex h-control max-w-[60%] items-center gap-2 text-[0.75rem] text-ink-3">
          {value.name === null || value.name === value.label ? null : (
            <span className="truncate">{value.name}</span>
          )}
          {value.held === null ? null : (
            <span className="shrink-0">
              você tem <span className="tabular ml-1">{value.held}</span>
            </span>
          )}
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
              {results.catalogEmpty
                ? CATALOG_EMPTY_MESSAGE
                : results.unavailable
                  ? `Nenhum papel com “${text}” no catálogo, e a consulta ao vivo não respondeu.`
                  : `Nenhum papel encontrado com “${text}”.`}
            </li>
          ) : (
            items.map((option, index) => (
              <li key={option.key} role="presentation">
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
                  onClick={() => choose(option)}
                >
                  {option.kind === 'asset' ? (
                    <>
                      <span className="min-w-0 truncate">
                        <strong className="tabular font-semibold">
                          {assetName(option.asset)}
                        </strong>
                        {assetName(option.asset) === option.asset.name ? null : (
                          <span className="ml-2 text-ink-3">{option.asset.name}</span>
                        )}
                      </span>
                      <span className="shrink-0 text-[0.75rem] text-ink-3">
                        {holdingLabel(option.asset)}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="min-w-0 truncate">
                        <strong className="tabular font-semibold">
                          {option.instrument.ticker}
                        </strong>
                        <span className="ml-2 text-ink-3">{option.instrument.name}</span>
                      </span>
                      <span className="shrink-0 text-[0.75rem] text-ink-3">
                        {INSTRUMENT_TYPE_LABELS[option.instrument.b3_type]}
                        {option.instrument.source === 'brapi' ? ' · brapi' : ''}
                      </span>
                    </>
                  )}
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
};
