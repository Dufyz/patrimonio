import type { SearchResource } from '@patrimonio/contracts';
import { useEffect, useId, useMemo, useRef, useState } from 'react';

import { SEARCH_TEXT_MAX, fetchSearch } from '../api/search.js';
import { browserStorage } from '../lib/preferences.js';
import type { Storageish } from '../lib/preferences.js';
import {
  FILTER_LABELS,
  SEARCH_DEBOUNCE_MS,
  buildModel,
  localItems,
  moveActive,
  nextFilter,
  readRecents,
  recentItems,
  rememberRecent,
  resolveActive,
} from '../lib/search.js';
import type {
  SearchActionId,
  SearchFilter,
  SearchItem,
  SearchPortfolio,
  SearchScreen,
  SearchServerState,
  SearchTarget,
} from '../lib/search.js';
import { Money } from './number.js';
import { Kbd, Label } from './primitives.js';
import { useDismiss } from './use_dismiss.js';

/**
 * D-13 · A busca global (⌘K).
 *
 * Uma paleta que executa: o mesmo campo acha uma tela, uma carteira, um ativo e
 * um lançamento, e cada resultado já é uma ação — ir, abrir, lançar. Do começo
 * ao fim sem o mouse: seta anda, Enter executa, Tab filtra por tipo, Esc fecha.
 *
 * Abrir não espera rede. O que a paleta mostra primeiro — recentes, telas e
 * ações — o navegador já tem, e é isso que a deixa abrir em menos de cem
 * milissegundos com a base cheia: o tamanho da base não entra na conta. Ativos
 * e lançamentos chegam da `api` depois, e entram na lista sem tirar de lugar o
 * item que a pessoa já marcou.
 *
 * A paleta não conhece o roteador. Ela devolve o *destino* escolhido
 * (`SearchTarget`) e quem a montou decide o que fazer com ele; assim a mesma
 * paleta serve à aplicação e à galeria.
 */

export type SearchPaletteProps = {
  readonly open: boolean;
  readonly onClose: () => void;
  /** O escopo atual, no canto do campo: é nele que a ação vai acontecer. */
  readonly scopeLabel: string;
  /** A carteira do escopo: a busca no banco mede a posição nela. Nulo desliga a busca. */
  readonly portfolioId: string | null;
  readonly screens: readonly SearchScreen[];
  readonly portfolios: readonly SearchPortfolio[];
  /** Quais ações já têm tela que as execute; as outras aparecem desativadas. */
  readonly readyActions: ReadonlySet<SearchActionId>;
  readonly onSelect: (target: SearchTarget) => void;
  /** A busca no banco. Troca-se nos testes; a identidade precisa ser estável. */
  readonly search?: (text: string, signal: AbortSignal) => Promise<SearchResource>;
  /** Onde os recentes moram. `null` desliga a persistência. */
  readonly storage?: Storageish | null;
};

export const SearchPalette = (props: SearchPaletteProps): React.ReactElement | null =>
  props.open ? <PaletteDialog {...props} /> : null;

const PaletteDialog = ({
  onClose,
  scopeLabel,
  portfolioId,
  screens,
  portfolios,
  readyActions,
  onSelect,
  search: injectedSearch,
  storage,
}: SearchPaletteProps): React.ReactElement => {
  const store = useMemo(
    () => (storage === undefined ? browserStorage() : storage),
    [storage],
  );

  const search = useMemo(
    () =>
      injectedSearch ??
      (portfolioId === null
        ? null
        : (text: string, signal: AbortSignal) => fetchSearch(text, portfolioId, signal)),
    [injectedSearch, portfolioId],
  );

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<SearchFilter>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [recents, setRecents] = useState(() => readRecents(store));
  const [server, setServer] = useState<SearchServerState>({ kind: 'idle' });

  const panel = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const opener = useRef<Element | null>(globalThis.document.activeElement);
  const listId = useId();

  useDismiss(panel, true, onClose);

  // Devolve o foco a quem abriu: sem isso, fechar a paleta manda o teclado de
  // volta ao começo do documento.
  useEffect(() => {
    input.current?.focus();
    const origin = opener.current;
    return () => {
      if (origin instanceof globalThis.HTMLElement) origin.focus();
    };
  }, []);

  /**
   * Um pedido por texto, depois de uma pausa curta. Digitar "itub" não paga
   * quatro idas ao banco, e cada pedido novo cancela o anterior: resposta
   * velha nunca sobrescreve a do texto que está na tela.
   */
  useEffect(() => {
    const text = query.trim();
    if (text === '' || search === null) {
      setServer({ kind: 'idle' });
      return;
    }

    setServer({ kind: 'loading' });
    const controller = new AbortController();
    const timer = setTimeout(() => {
      search(text, controller.signal)
        .then((resource) => {
          if (!controller.signal.aborted) setServer({ kind: 'ready', resource });
        })
        .catch(() => {
          if (!controller.signal.aborted) setServer({ kind: 'error' });
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, search]);

  const local = useMemo(
    () => localItems({ screens, portfolios, readyActions }),
    [screens, portfolios, readyActions],
  );

  const model = useMemo(
    () =>
      buildModel({
        query,
        filter,
        local,
        recents: recentItems(recents),
        server,
        readyActions,
      }),
    [query, filter, local, recents, server, readyActions],
  );

  const active = resolveActive(model.sections, activeId);

  useEffect(() => {
    if (active === null) return;
    globalThis.document
      .getElementById(optionId(listId, active.id))
      ?.scrollIntoView?.({ block: 'nearest' });
  }, [active, listId]);

  const choose = (item: SearchItem): void => {
    if (item.disabled !== null) return;
    setRecents(rememberRecent(store, item));
    onSelect(item.target);
    onClose();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp':
        event.preventDefault();
        setActiveId(
          moveActive(
            model.sections,
            active?.id ?? null,
            event.key === 'ArrowDown' ? 1 : -1,
          ),
        );
        return;
      case 'Enter':
        event.preventDefault();
        if (active !== null) choose(active);
        return;
      case 'Tab':
        // Tab filtra por tipo, e por isso não passa o foco adiante: a paleta é
        // um campo só, e o foco que saísse dele deixaria o Enter sem destino.
        event.preventDefault();
        setFilter((current) => nextFilter(current, event.shiftKey));
        return;
      default:
    }
  };

  const idle = query.trim() === '';
  const emptyResult = !idle && server.kind === 'ready' && model.sections.length === 0;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-overlay p-4 pt-[12vh]">
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="Busca global"
        className="flex max-h-[32rem] w-full max-w-xl flex-col overflow-hidden rounded-panel border border-line bg-panel shadow-xl"
      >
        <div className="flex items-center gap-3 border-b border-line px-4 py-3">
          <span aria-hidden="true" className="text-ink-3">
            ⌕
          </span>
          <input
            ref={input}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={
              active === null ? undefined : optionId(listId, active.id)
            }
            aria-label="Buscar telas, ativos, lançamentos ou ações"
            placeholder="Buscar telas, ativos, lançamentos ou ações"
            maxLength={SEARCH_TEXT_MAX}
            autoComplete="off"
            spellCheck={false}
            value={query}
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-3"
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveId(null);
            }}
            onKeyDown={onKeyDown}
          />
          {filter === null ? null : (
            <span className="rounded-full border border-accent bg-accent-soft px-2 py-0.5 text-[0.6875rem] text-accent">
              {FILTER_LABELS[filter]}
            </span>
          )}
          <span className="rounded-full border border-line px-2.5 py-0.5 text-[0.75rem] font-medium">
            {scopeLabel}
          </span>
          <Kbd>esc</Kbd>
        </div>

        <div
          id={listId}
          role="listbox"
          aria-label="Resultados"
          className="min-h-0 flex-1 overflow-y-auto px-2 py-1"
        >
          {model.sections.map((section) => (
            <section key={section.group} aria-label={section.title} className="py-1">
              <div className="px-2 pt-1 pb-1">
                <Label>{section.title}</Label>
              </div>
              {section.items.map((item) => (
                <Option
                  key={item.id}
                  id={optionId(listId, item.id)}
                  item={item}
                  active={item.id === active?.id}
                  onHover={() => item.disabled === null && setActiveId(item.id)}
                  onChoose={() => choose(item)}
                />
              ))}
            </section>
          ))}

          {!idle && server.kind === 'loading' ? (
            <p role="status" className="px-3 py-2 text-[0.8125rem] text-ink-3">
              Buscando ativos e lançamentos…
            </p>
          ) : null}
          {!idle && server.kind === 'error' ? (
            <p role="status" className="px-3 py-2 text-[0.8125rem] text-ink-3">
              Não foi possível buscar ativos e lançamentos agora. As telas e as ações
              continuam valendo.
            </p>
          ) : null}
          {emptyResult ? (
            <p
              role="status"
              className="px-3 py-6 text-center text-[0.8125rem] text-ink-3"
            >
              Nada encontrado para “{query.trim()}”.
            </p>
          ) : null}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-line bg-panel-2 px-4 py-2 text-[0.75rem] text-ink-3">
          <span className="flex items-center gap-1.5">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd>
            navegar ·<Kbd>↵</Kbd>
            abrir ·<Kbd>tab</Kbd>
            filtrar por tipo
          </span>
          {model.total > model.shown ? (
            <span className="tabular">
              mostrando {model.shown} de {model.total}
            </span>
          ) : null}
        </footer>
      </div>
    </div>
  );
};

const optionId = (listId: string, itemId: string): string =>
  `${listId}-${itemId.replace(/[^A-Za-z0-9_-]/g, '_')}`;

const Option = ({
  id,
  item,
  active,
  onHover,
  onChoose,
}: {
  readonly id: string;
  readonly item: SearchItem;
  readonly active: boolean;
  readonly onHover: () => void;
  readonly onChoose: () => void;
}): React.ReactElement => (
  <div
    id={id}
    role="option"
    aria-selected={active}
    aria-disabled={item.disabled !== null ? true : undefined}
    className={`flex h-9 items-center gap-3 rounded-control px-2 text-sm ${
      item.disabled !== null
        ? 'cursor-not-allowed text-ink-3'
        : active
          ? 'cursor-pointer bg-accent-soft'
          : 'cursor-pointer hover:bg-panel-2'
    }`}
    onMouseMove={onHover}
    // O campo mantém o foco: perder o foco no clique fecharia a paleta pelo
    // clique-fora antes de o item ser escolhido.
    onMouseDown={(event) => event.preventDefault()}
    onClick={onChoose}
  >
    <span aria-hidden="true" className="w-4 shrink-0 text-center text-ink-3">
      {item.glyph}
    </span>
    <span className="min-w-0 flex-1 truncate">
      <span className={item.group === 'assets' ? 'tabular font-semibold' : ''}>
        {item.label}
      </span>
      {item.detail === null ? null : (
        <>
          {/* Espaço de verdade, e não só margem: o leitor de tela junta os dois
              textos, e "ITUB4Itaú" não é uma palavra. */}{' '}
          <span className="ml-1 text-[0.8125rem] text-ink-3">{item.detail}</span>
        </>
      )}
    </span>
    {item.disabled !== null ? (
      <span className="shrink-0 text-[0.75rem] text-ink-3">{item.disabled}</span>
    ) : item.amount !== null ? (
      <Money value={item.amount} />
    ) : item.shortcut !== null ? (
      <span className="flex shrink-0 gap-1">
        {item.shortcut.split(' ').map((key, index) => (
          <Kbd key={`${key}-${index}`}>{key}</Kbd>
        ))}
      </span>
    ) : null}
  </div>
);
