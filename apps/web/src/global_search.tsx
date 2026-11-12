import { useCallback, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router';

import { useEntry } from './components/entry_provider.js';
import { usePortfolios } from './components/portfolios_provider.js';
import { SearchPalette } from './components/search_palette.js';
import { ALL_PORTFOLIOS } from './components/shell.js';
import { financeSearchItems } from './finance/domain/search.js';
import { useFinancePeriod } from './finance/components/period_provider.js';
import { useFinanceData, useFinanceStore } from './finance/store/finance_store.js';
import { routes } from './lib/routes.js';
import { ALL_SCOPE, scopeForPortfolioId } from './lib/scope.js';
import { targetPath } from './lib/search.js';
import type { SearchActionId, SearchScreen, SearchTarget } from './lib/search.js';

/**
 * NAV-007 · A busca global, uma só para a aplicação inteira.
 *
 * É a paleta de Investimentos — ativos, papéis do mercado, lançamentos, telas e
 * ações — com Finanças como mais um grupo e as telas de todas as áreas na lista
 * "Ir para". Ela mora na casca: abre com ⌘K em qualquer tela, e o que ela
 * escolhe leva à área certa.
 */

/** As ações da paleta que o modal de lançamento executa. */
const READY_ACTIONS: ReadonlySet<SearchActionId> = new Set([
  'new_transaction',
  'buy_asset',
  'payout_asset',
]);

export const GlobalSearch = ({
  open,
  onClose,
  scope,
  scopeLabel,
  portfolioId,
  currentScreen,
  inFinance,
  screens,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  /** O escopo de Investimentos: o da URL, ou o último usado. */
  readonly scope: string;
  readonly scopeLabel: string;
  readonly portfolioId: string | null;
  /** A tela de Investimentos aberta, ou a última, para trocar de carteira sem trocar de tela. */
  readonly currentScreen: string;
  /** Em Geral e Finanças os dados já foram lidos; fora delas, a abertura os lê. */
  readonly inFinance: boolean;
  readonly screens: readonly SearchScreen[];
}): React.ReactElement | null => {
  const navigate = useNavigate();
  const entry = useEntry();
  const { portfolios, slugs } = usePortfolios();
  const store = useFinanceStore();
  const data = useFinanceData();
  const { today } = useFinancePeriod();

  // Fora de Finanças, abrir a busca lê a foto dos dados: os resultados de
  // Finanças chegam enquanto a pessoa digita.
  useEffect(() => {
    if (open && !inFinance) store.start();
  }, [open, inFinance, store]);

  const finance = useCallback(
    (query: string) => financeSearchItems(data, query, today),
    [data, today],
  );

  const searchPortfolios = useMemo(
    () => [
      { id: ALL_PORTFOLIOS, label: 'Todas as carteiras' },
      ...portfolios.map((portfolio) => ({ id: portfolio.id, label: portfolio.name })),
    ],
    [portfolios],
  );

  const allPortfolios = scope === ALL_SCOPE;

  const openTarget = (target: SearchTarget): void => {
    // Sem página de ativo em "Todas as carteiras": o ativo aparece em Posições,
    // já filtrado por ele, com a carteira de cada linha.
    if (allPortfolios && target.kind === 'asset') {
      void navigate(
        `${routes.portfolio(ALL_SCOPE, 'posicoes')}?${new URLSearchParams({ busca: target.slug }).toString()}`,
      );
      return;
    }

    const path = targetPath(target, {
      scope,
      currentScreenPath: currentScreen,
      screenPaths: {},
      scopeFor: (id) =>
        id === ALL_PORTFOLIOS ? ALL_SCOPE : (scopeForPortfolioId(id, slugs) ?? scope),
    });
    // Ação não é navegação: quem a executa é o modal de lançamento, logo abaixo.
    if (path !== null) void navigate(path);
  };

  const onSelect = (target: SearchTarget): void => {
    if (target.kind === 'instrument') {
      entry.openEntry({
        tab: 'buy',
        asset: {
          id: null,
          instrument: {
            ticker: target.ticker,
            name: target.name,
            b3_type: target.b3_type,
          },
          label: target.ticker,
          name: target.name,
          held: null,
        },
      });
      return;
    }

    if (target.kind !== 'action') {
      openTarget(target);
      return;
    }

    const asset =
      target.assetId === undefined
        ? null
        : {
            id: target.assetId,
            instrument: null,
            label: target.title ?? '',
            name: null,
            held: null,
          };

    entry.openEntry({
      tab: target.action === 'payout_asset' ? 'payout' : 'buy',
      asset,
    });
  };

  return (
    <SearchPalette
      open={open}
      onClose={onClose}
      scopeLabel={scopeLabel}
      portfolioId={portfolioId}
      screens={screens}
      portfolios={searchPortfolios}
      readyActions={READY_ACTIONS}
      finance={finance}
      onSelect={onSelect}
    />
  );
};
