import type { PortfolioResource } from '@patrimonio/contracts';
import { useEffect, useMemo, useState } from 'react';
import {
  Navigate,
  Route,
  Routes,
  useNavigate,
  useParams,
  BrowserRouter,
} from 'react-router';

import { fetchPortfolios } from './api/portfolios.js';
import { fetchPositions } from './api/positions.js';
import { ShortcutProvider, useShortcuts } from './components/shortcuts.js';
import { ALL_PORTFOLIOS, AppShell } from './components/shell.js';
import type { ScreenItem } from './components/shell.js';
import {
  ALL_SCOPE,
  portfolioIdForScope,
  portfolioSlugs,
  scopeForPortfolioId,
} from './lib/scope.js';
import { AssetScreen } from './views/asset.js';
import { Gallery } from './views/gallery.js';
import { OverviewScreen } from './views/overview.js';
import { PositionsScreen } from './views/positions.js';

/**
 * E6 · A moldura e as telas.
 *
 * Até E5 o que a aplicação abria era a galeria do design system. Agora ela abre
 * a Visão geral, como a prancha `02 · Mapa de telas e navegação` manda — é a
 * tela que responde "quanto eu tenho hoje" —, e a galeria continua existindo em
 * `/galeria`: ela é o lugar onde uma mudança no botão aparece antes de aparecer
 * em seis telas.
 *
 * O escopo e a tela vivem na URL, não em estado. Trocar de carteira mantém a
 * tela atual, porque quem troca está comparando, não recomeçando.
 */

const SCREENS: readonly (ScreenItem & {
  readonly path: string;
  readonly story: string;
})[] = [
  { id: 'visao', label: 'Visão geral', icon: '▦', path: 'visao-geral', story: 'T-01' },
  { id: 'posicoes', label: 'Posições', icon: '≡', path: 'posicoes', story: 'T-02' },
  {
    id: 'movimentacoes',
    label: 'Movimentações',
    icon: '⇄',
    path: 'movimentacoes',
    story: 'T-04',
  },
  {
    id: 'desempenho',
    label: 'Desempenho',
    icon: '◹',
    path: 'desempenho',
    story: 'T-05',
  },
  { id: 'estrategia', label: 'Estratégia', icon: '◎', path: 'estrategia', story: 'T-06' },
  { id: 'objetivos', label: 'Objetivos', icon: '⚑', path: 'objetivos', story: 'T-07' },
];

export const App = (): React.ReactElement => (
  <BrowserRouter>
    <ShortcutProvider>
      <Workspace />
    </ShortcutProvider>
  </BrowserRouter>
);

const Workspace = (): React.ReactElement => (
  <Routes>
    <Route path="/galeria" element={<Gallery />} />
    {/* A página do ativo é uma tela dentro do escopo, e não uma tela da barra
        lateral: ela pertence ao papel, e o papel pertence à carteira. Por isso
        ela mora sob o escopo e mantém Posições destacada na navegação. */}
    <Route path="/:scope/ativo/:asset" element={<Workbench />} />
    <Route path="/:scope/:screen" element={<Workbench />} />
    <Route path="*" element={<Navigate to={`/${ALL_SCOPE}/visao-geral`} replace />} />
  </Routes>
);

const Workbench = (): React.ReactElement => {
  const { scope = ALL_SCOPE, screen = 'visao-geral', asset } = useParams();
  const navigate = useNavigate();

  const [portfolios, setPortfolios] = useState<readonly PortfolioResource[]>([]);
  const [values, setValues] = useState<ReadonlyMap<string, string>>(new Map());

  useEffect(() => {
    const controller = new AbortController();
    fetchPortfolios(controller.signal)
      .then(setPortfolios)
      .catch(() => setPortfolios([]));
    return () => controller.abort();
  }, []);

  /**
   * O valor de cada carteira na barra lateral vem de um pedido só, agrupado por
   * carteira: o subtotal de cada grupo é exatamente o número que a barra mostra,
   * e ele é somado onde todos os outros são somados — na `api`.
   */
  useEffect(() => {
    const controller = new AbortController();
    fetchPositions(
      { portfolioId: null, groupBy: 'portfolio', search: '', categoryId: null },
      controller.signal,
    )
      .then((resource) =>
        setValues(
          new Map(
            resource.groups.flatMap((group) =>
              group.positions[0] === undefined
                ? []
                : [[group.positions[0].portfolio_id, group.summary.value] as const],
            ),
          ),
        ),
      )
      .catch(() => setValues(new Map()));
    return () => controller.abort();
  }, []);

  const slugs = useMemo(() => portfolioSlugs(portfolios), [portfolios]);
  const portfolioId = portfolioIdForScope(scope, slugs);

  // Com um ativo na URL, a tela ativa continua sendo Posições: a página do
  // ativo foi aberta de lá, e é para lá que a trilha volta.
  const current =
    asset === undefined
      ? (SCREENS.find((item) => item.path === screen) ?? SCREENS[0])
      : SCREENS[1];
  const scopeLabel =
    portfolioId === null
      ? 'Todas as carteiras'
      : (portfolios.find((item) => item.id === portfolioId)?.name ?? 'Carteira');

  const shortcuts = useMemo(
    () =>
      Object.fromEntries(
        SCREENS.map((item) => [
          `go_${SHORTCUT_IDS[item.id] ?? item.id}`,
          () => navigate(`/${scope}/${item.path}`),
        ]),
      ),
    [navigate, scope],
  );
  useShortcuts(shortcuts);

  return (
    <AppShell
      portfolios={[
        { id: ALL_PORTFOLIOS, label: 'Todas as carteiras', value: null },
        ...portfolios.map((portfolio) => ({
          id: portfolio.id,
          label: portfolio.name,
          value: values.get(portfolio.id) ?? null,
        })),
      ]}
      screens={SCREENS.map(({ id, label, icon }) => ({ id, label, icon }))}
      scope={portfolioId ?? ALL_PORTFOLIOS}
      screen={current?.id ?? 'visao'}
      onNavigate={(nextScope, nextScreen) => {
        const target = SCREENS.find((item) => item.id === nextScreen) ?? SCREENS[0];
        const slug =
          nextScope === ALL_PORTFOLIOS
            ? ALL_SCOPE
            : scopeForPortfolioId(nextScope, slugs);
        navigate(`/${slug}/${target?.path ?? 'visao-geral'}`);
      }}
      onOpenSearch={() => navigate('/galeria')}
      onOpenSettings={() => navigate('/galeria')}
    >
      {asset !== undefined ? (
        <AssetScreen
          assetRef={asset}
          portfolioId={portfolioId}
          scopeLabel={scopeLabel}
          onBack={() => navigate(`/${scope}/posicoes`)}
        />
      ) : current?.id === 'visao' ? (
        <OverviewScreen
          portfolioId={portfolioId}
          onOpenAsset={(slug) => navigate(`/${scope}/ativo/${slug}`)}
        />
      ) : current?.id === 'posicoes' ? (
        <PositionsScreen
          portfolioId={portfolioId}
          scopeLabel={scopeLabel}
          onOpenAsset={(slug) => navigate(`/${scope}/ativo/${slug}`)}
        />
      ) : (
        <ScreenPending label={current?.label ?? ''} story={current?.story ?? ''} />
      )}
    </AppShell>
  );
};

const SHORTCUT_IDS: Readonly<Record<string, string>> = {
  visao: 'overview',
  posicoes: 'positions',
  movimentacoes: 'transactions',
  desempenho: 'performance',
  estrategia: 'strategy',
  objetivos: 'goals',
};

/**
 * A tela que ainda não existe diz qual história a entrega, em vez de abrir em
 * branco. Em E6 ela some uma por vez.
 */
const ScreenPending = ({
  label,
  story,
}: {
  readonly label: string;
  readonly story: string;
}): React.ReactElement => (
  <div className="flex flex-col gap-1 rounded-panel border border-line bg-panel p-6">
    <h1 className="text-base font-semibold">{label}</h1>
    <p className="text-[0.8125rem] text-ink-3">
      Esta tela chega com {story}. Visão geral e Posições já estão de pé.
    </p>
  </div>
);
