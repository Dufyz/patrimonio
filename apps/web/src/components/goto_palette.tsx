import { useMemo, useState } from 'react';

import { Modal } from './overlay.js';

/**
 * NAV-007 · "Ir para": a busca de quem está em Geral (ou em qualquer tela cuja
 * área não tem busca própria). Lista as telas das três áreas e as carteiras, e
 * leva a uma delas. Em Finanças e em Investimentos a busca da área segue
 * procurando lançamentos e ativos; esta procura lugares.
 */
export type Destination = {
  readonly id: string;
  /** A trilha: `Finanças › Contas`. */
  readonly label: string;
  readonly path: string;
};

const normalize = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[̀-ͯ]/gu, '')
    .toLowerCase();

export const GoToPalette = ({
  open,
  destinations,
  onGo,
  onClose,
}: {
  readonly open: boolean;
  readonly destinations: readonly Destination[];
  readonly onGo: (path: string) => void;
  readonly onClose: () => void;
}): React.ReactElement | null => {
  const [query, setQuery] = useState('');

  const matches = useMemo(() => {
    const needle = normalize(query.trim());
    return needle === ''
      ? destinations
      : destinations.filter((item) => normalize(item.label).includes(needle));
  }, [destinations, query]);

  const go = (path: string): void => {
    setQuery('');
    onClose();
    onGo(path);
  };

  return (
    <Modal open={open} title="Ir para" onClose={onClose} narrow>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const first = matches[0];
          if (first !== undefined) go(first.path);
        }}
      >
        <input
          type="search"
          autoFocus
          aria-label="Ir para"
          placeholder="Contas, Posições, uma carteira…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="h-control w-full rounded-control border border-line bg-panel px-3 text-[0.8125rem]"
        />
      </form>
      {matches.length === 0 ? (
        <p className="mt-3 text-[0.8125rem] text-ink-3">Nenhuma tela com esse nome.</p>
      ) : (
        <ul className="mt-3 flex max-h-80 flex-col overflow-y-auto">
          {matches.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className="w-full cursor-pointer rounded-control px-3 py-2 text-left text-[0.8125rem] hover:bg-panel-2"
                onClick={() => go(item.path)}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
};
