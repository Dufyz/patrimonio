import type { PortfolioResource } from '@patrimonio/contracts';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';

import { fetchPortfolios } from '../api/portfolios.js';
import { onPortfoliosChanged } from '../lib/portfolio_events.js';
import { portfolioSlugs } from '../lib/scope.js';

/**
 * NAV-003 · As carteiras de que a barra lateral e as telas precisam, lidas uma
 * vez para o app inteiro. Quem cria, renomeia ou exclui uma carteira avisa por
 * `notifyPortfoliosChanged`, e a lista é relida.
 */

export type PortfoliosState = {
  readonly portfolios: readonly PortfolioResource[];
  /** O valor de cada carteira na última consolidação, por identificador. */
  readonly values: Readonly<Record<string, string>>;
  /** A soma das carteiras: o valor de "Todas as carteiras". */
  readonly total: string | null;
  /** O apelido de cada carteira na URL, por identificador. */
  readonly slugs: ReadonlyMap<string, string>;
  readonly loaded: boolean;
  readonly failed: Error | null;
  readonly reload: () => void;
};

const EMPTY: PortfoliosState = {
  portfolios: [],
  values: {},
  total: null,
  slugs: new Map(),
  loaded: true,
  failed: null,
  reload: () => undefined,
};

const PortfoliosContext = createContext<PortfoliosState>(EMPTY);

export const PortfoliosProvider = ({
  children,
}: {
  readonly children: React.ReactNode;
}): React.ReactElement => {
  const [portfolios, setPortfolios] = useState<readonly PortfolioResource[]>([]);
  const [values, setValues] = useState<Readonly<Record<string, string>>>({});
  const [total, setTotal] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState<Error | null>(null);
  const [reloads, setReloads] = useState(0);

  useEffect(() => onPortfoliosChanged(() => setReloads((count) => count + 1)), []);

  useEffect(() => {
    const controller = new AbortController();
    fetchPortfolios(controller.signal)
      .then((list) => {
        setFailed(null);
        setPortfolios(list.portfolios);
        setValues(list.values);
        setTotal(list.total);
        setLoaded(true);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        // Falha ao ler as carteiras não é "nenhuma carteira": mostrar a tela de
        // boas-vindas para quem tem carteira e uma api fora do ar seria mentir.
        setFailed(error instanceof Error ? error : new Error(String(error)));
        setLoaded(true);
      });
    return () => controller.abort();
  }, [reloads]);

  const slugs = useMemo(() => portfolioSlugs(portfolios), [portfolios]);
  const value = useMemo<PortfoliosState>(
    () => ({
      portfolios,
      values,
      total,
      slugs,
      loaded,
      failed,
      reload: () => {
        setLoaded(false);
        setReloads((count) => count + 1);
      },
    }),
    [portfolios, values, total, slugs, loaded, failed],
  );

  return (
    <PortfoliosContext.Provider value={value}>{children}</PortfoliosContext.Provider>
  );
};

export const usePortfolios = (): PortfoliosState => useContext(PortfoliosContext);
