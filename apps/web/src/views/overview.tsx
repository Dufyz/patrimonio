import { AlocacaoPanel } from './geral/alocacao_panel.js';
import { CarteirasPanel } from './geral/carteiras_panel.js';
import { EvolucaoPanel } from './geral/evolucao_panel.js';
import { ObjetivosPanel } from './geral/objetivos_panel.js';
import { PosicoesPanel } from './geral/posicoes_panel.js';
import { routes } from '../lib/routes.js';
import { ALL_SCOPE } from '../lib/scope.js';
import type {
  GoalsOverviewResource,
  OverviewResource,
  PerformanceResource,
} from '@patrimonio/contracts';
import type { DateOnly } from '@patrimonio/domain';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';

import { fetchGoalsOverview } from '../api/goals.js';
import { fetchOverview } from '../api/overview.js';
import { fetchPerformance } from '../api/performance.js';

import { useEntry } from '../components/entry_provider.js';
import { useShortcuts } from '../components/shortcuts.js';
import { KeepPrevious } from '../components/pending.js';
import { PeriodControl } from '../components/period_control.js';
import { usePreferences } from '../components/preferences.js';
import { Button, IconButton, Panel } from '../components/primitives.js';
import { SeriesChart } from '../components/series_chart.js';
import type { Period } from '../lib/period.js';
import {
  DEFAULT_PERIOD,
  PERIOD_LABELS,
  decodePeriod,
  encodePeriod,
  resolvePeriod,
  returnsPeriod,
  windowLabel,
} from '../lib/period.js';
import {
  CONTRIBUTIONS_COLOR,
  formatDate,
  growthBands,
  monthTicks,
  resultColor,
} from '../lib/overview.js';
import type { Resource } from '../lib/use_resource.js';
import { useResource } from '../lib/use_resource.js';
import { axisFloor, toNumber } from '../lib/chart/scale.js';
import { SEMANTIC_COLORS } from '../lib/tokens.js';
import { listParam, readParams, writeParams } from '../lib/url_state.js';
import { Icon } from '../components/icon.js';
import { ReturnsBars, ReturnsBenchmarkAction } from './overview_returns.js';
import type { PortfolioReturn } from './overview_returns.js';
import { HomeScopeControl } from '../components/home_scope_control.js';
import { usePortfolios } from '../components/portfolios_provider.js';
import {
  SkeletonChart,
  SkeletonBar,
  SkeletonPanel,
  SkeletonRegion,
  SkeletonTable,
} from '../components/skeleton.js';
import { ScreenFailed } from '../components/panel_state.js';

/**
 * T-01 · Visão geral — a prancha `04 · Visão geral`, que também carrega o que
 * era a tela de Desempenho.
 *
 * A tela responde, nessa ordem: **quanto eu tenho hoje**, **como o patrimônio
 * evoluiu** (aporte separado de rendimento, ou retorno contra benchmarks no
 * mesmo gráfico) e **como ele está distribuído**. O patrimônio e a variação
 * abrem a tela porque é a pergunta que faz a pessoa entrar.
 *
 * Nada aqui faz conta com dinheiro. Peso, desvio, variação e rentabilidade
 * chegam prontos da `api`; o que a tela faz com eles é escolher a cor, a casa
 * decimal e a ordem — e `percentAsRatio` move a vírgula sobre a string, sem
 * passar por `number`.
 */
export type OverviewViewProps = {
  /** O escopo pedido, conhecido antes da resposta: o cabeçalho não espera por ela. */
  readonly portfolioId?: string | null | undefined;
  readonly resource: Resource<OverviewResource>;
  /**
   * O retorno contra benchmarks: gráfico, janelas e classes. Nulo quando a
   * leitura não foi pedida; a tela então mostra só o que não depende dela.
   */
  readonly performance: Resource<PerformanceResource> | null;
  /** Em Todas, o retorno de cada carteira no período; nulo nos demais casos. */
  readonly portfolioReturns?:
    Resource<readonly PortfolioReturn[] | null> | null | undefined;
  /** O objetivo da carteira (ou os de todas): alimenta o painel de independência. */
  readonly goals?: Resource<GoalsOverviewResource> | null | undefined;
  /** A leitura de Todas as carteiras: alimenta o retorno de cada carteira no painel Carteiras. */
  readonly portfoliosPerformance?: Resource<PerformanceResource> | null | undefined;
  readonly period: Period;
  readonly onPeriodChange: (period: Period) => void;
  /** Os benchmarks pedidos além do da carteira, que a URL guarda. */
  readonly extraIds: readonly string[];
  readonly onExtraIdsChange: (ids: readonly string[]) => void;
  readonly today: DateOnly;
  readonly onOpenAsset?: ((slug: string) => void) | undefined;
  /** Leva a outra tela do escopo: `estrategia`, `posicoes`, `objetivos`. */
  readonly onOpenScreen?:
    ((path: 'estrategia' | 'posicoes' | 'objetivos') => void) | undefined;
  /** Abre a Visão geral de uma carteira, a partir da distribuição por carteira. */
  readonly onOpenPortfolio?: ((portfolioId: string) => void) | undefined;
};

export type OverviewScreenProps = {
  /** Nulo é o escopo de todas as carteiras. */
  readonly portfolioId: string | null;
  /** Abre a página do ativo (T-03), pelo mesmo apelido que Posições usa. */
  readonly onOpenAsset?: ((slug: string) => void) | undefined;
  readonly onOpenScreen?:
    ((path: 'estrategia' | 'posicoes' | 'objetivos') => void) | undefined;
  readonly onOpenPortfolio?: ((portfolioId: string) => void) | undefined;
};

const CODECS = { benchmarks: listParam('benchmarks') } as const;

/** O relógio entra uma vez, na borda: nenhuma função pura chama `new Date()`. */
const todayIso = (): DateOnly => new Date().toISOString().slice(0, 10) as DateOnly;

/**
 * A tela como a rota a monta: período na query, escopo vindo do endereço e a
 * leitura num pedido só. O padrão nunca é escrito na URL — `/longo-prazo` é o
 * recorte de doze meses, e não `/longo-prazo?periodo=12m`.
 */
export const OverviewScreen = ({
  portfolioId,
  onOpenAsset,
  onOpenScreen,
  onOpenPortfolio,
}: OverviewScreenProps): React.ReactElement => {
  const [params, setParams] = useSearchParams();
  const today = todayIso();

  const period = decodePeriod(params.get('periodo'));
  const { benchmarks: extraIds } = readParams(params, CODECS);

  const onPeriodChange = useCallback(
    (next: Period) => {
      setParams(
        (current) => {
          const search = new URLSearchParams(current);
          const encoded = encodePeriod(next);
          if (encoded === encodePeriod(DEFAULT_PERIOD)) search.delete('periodo');
          else search.set('periodo', encoded);
          return search;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const onExtraIdsChange = useCallback(
    (ids: readonly string[]) =>
      setParams((current) => writeParams(current, CODECS, { benchmarks: ids }), {
        replace: true,
      }),
    [setParams],
  );

  /**
   * "Início" só tem significado depois que a primeira resposta diz qual é o
   * primeiro fechamento do escopo. Até lá vale a janela de doze meses, que é a
   * da prancha: nenhuma tela espera por uma data que ela ainda não tem.
   */
  const [inception, setInception] = useState<DateOnly | null>(null);
  const range = resolvePeriod(period, today, inception);
  const returns = returnsPeriod(today, inception);
  const returnsRange = resolvePeriod(returns, today, inception);

  const resource = useResource(
    (signal) => fetchOverview({ portfolioId, from: range.from, to: range.to }, signal),
    [portfolioId, range.from, range.to],
  );

  // Em Todas as carteiras a cota é reconstruída sobre a soma, e o benchmark é o
  // CDI (ou o que a pessoa escolher): nenhuma carteira dita o padrão.
  const performance = useResource(
    (signal) =>
      fetchPerformance(
        {
          portfolioId,
          from: returnsRange.from,
          to: returnsRange.to,
          benchmarks: extraIds,
        },
        signal,
      ),
    [portfolioId, returnsRange.from, returnsRange.to, extraIds.join(',')],
  );

  // Em Todas, cada carteira rende pela cota dela: uma leitura por carteira, no
  // mesmo período, e o retorno é o último ponto da série acumulada.
  const { portfolios } = usePortfolios();
  const portfolioKey = portfolios.map((item) => item.id).join(',');
  const portfolioReturns = useResource(
    async (signal): Promise<readonly PortfolioReturn[] | null> => {
      if (portfolioId !== null) return null;
      return Promise.all(
        portfolios.map(async (portfolio): Promise<PortfolioReturn> => {
          const one = await fetchPerformance(
            { portfolioId: portfolio.id, from: returnsRange.from, to: returnsRange.to },
            signal,
          );
          const values = one.chart.portfolio;
          return {
            id: portfolio.id,
            name: portfolio.name,
            value:
              one.chart.base_date === null || values.length < 2
                ? null
                : (values[values.length - 1] ?? null),
          };
        }),
      );
    },
    [portfolioId, returnsRange.from, returnsRange.to, portfolioKey],
  );

  const goals = useResource((signal) => fetchGoalsOverview({}, signal), [portfolioId]);

  // O painel Carteiras lista todas, também quando o escopo é uma só; o retorno de
  // cada uma vem da leitura de Todas as carteiras.
  const portfoliosPerformance = useResource(
    (signal) =>
      fetchPerformance(
        { portfolioId: null, from: returnsRange.from, to: returnsRange.to },
        signal,
      ),
    [returnsRange.from, returnsRange.to],
  );

  useEffect(() => {
    if (resource.state.kind === 'ready') {
      setInception(resource.state.value.scope.inception as DateOnly | null);
    }
  }, [resource.state]);

  return (
    <OverviewView
      portfolioId={portfolioId}
      resource={resource}
      performance={performance}
      portfolioReturns={portfolioReturns}
      goals={goals}
      portfoliosPerformance={portfoliosPerformance}
      period={period}
      onPeriodChange={onPeriodChange}
      extraIds={extraIds}
      onExtraIdsChange={onExtraIdsChange}
      today={today}
      {...(onOpenAsset === undefined ? {} : { onOpenAsset })}
      {...(onOpenScreen === undefined ? {} : { onOpenScreen })}
      {...(onOpenPortfolio === undefined ? {} : { onOpenPortfolio })}
    />
  );
};

/**
 * O rótulo curto que cabe na coluna de métricas do cabeçalho: `Rent. 12M`, e
 * não `Rentabilidade nos últimos doze meses`. A coluna tem a largura de um
 * número, e o rótulo que não cabe é o que a pessoa para de ler.
 */
const periodSuffix = (period: Period): string =>
  period.kind === 'custom' ? 'no período' : PERIOD_LABELS[period.preset];

/**
 * O piso do eixo da evolução (prancha 1: "eixo a partir de R$ 100k"). Zero
 * quando a série é curta ou toca o zero; aí o eixo parte de zero, como antes.
 */
export const evolutionFloor = (overview: OverviewResource): number =>
  axisFloor(
    overview.series.flatMap((point) => {
      const total = toNumber(point.total);
      const contributions = toNumber(point.contributions);
      return total === null || contributions === null ? [] : [total, contributions];
    }),
  );

export const Evolution = ({
  overview,
}: {
  readonly overview: OverviewResource;
}): React.ReactElement => {
  const floor = evolutionFloor(overview);
  const bands = growthBands(overview.series, floor);
  const ticks = monthTicks(bands.dates);

  if (bands.dates.length === 0) {
    return (
      <p className="flex h-full min-h-40 items-center justify-center text-[0.8125rem] text-ink-3">
        Sem consolidação no período escolhido.
      </p>
    );
  }

  return (
    <SeriesChart
      dates={bands.dates}
      series={[
        {
          id: 'patrimonio',
          label: 'Patrimônio',
          color: SEMANTIC_COLORS.ink,
          points: bands.total,
        },
      ]}
      bands={[
        {
          id: 'aportes',
          label: 'Aportes acumulados',
          color: CONTRIBUTIONS_COLOR,
          values: bands.contributions,
        },
        {
          id: 'rendimento',
          label: bands.underwater ? 'Resultado' : 'Rendimento',
          color: resultColor(bands.underwater),
          values: bands.result,
          signed: true,
        },
        ...(bands.hasPayouts
          ? [
              {
                id: 'proventos',
                label: 'Proventos recebidos',
                color: SEMANTIC_COLORS.payouts,
                values: bands.payouts,
                signed: true,
              },
            ]
          : []),
      ]}
      valueFormat="money"
      fromZero={floor === 0}
      floor={floor > 0 ? floor : undefined}
      endDot
      inception={overview.scope.inception as DateOnly | null}
      ariaLabel="Evolução do patrimônio, separando aporte, rendimento e proventos"
      xTickLabel={(date) => ticks.get(date) ?? ''}
      tooltipDateLabel={(date) => formatDate(date)}
    />
  );
};

const Empty = ({ scope }: { readonly scope: string }): React.ReactElement => (
  <section className="rounded-panel border border-line bg-panel p-8 text-center">
    <h2 className="text-panel-title font-semibold">Carteira ainda não consolidada</h2>
    <p className="mx-auto mt-2 max-w-prose text-[0.8125rem] text-ink-2">
      {scope} não tem posição calculada. A primeira movimentação começa a história: a
      consolidação do dia roda em seguida e esta tela passa a responder quanto você tem.
    </p>
  </section>
);

const Failed = ScreenFailed;

const NO_GOALS: Resource<GoalsOverviewResource> = {
  state: { kind: 'loading' },
  pending: false,
  reload: () => undefined,
};

/** O esqueleto tem a forma das pranchas 1.3 e 1.4: os mesmos painéis, na mesma grade. */
const Skeleton = ({
  consolidated,
}: {
  readonly consolidated: boolean;
}): React.ReactElement => (
  <SkeletonRegion label="Carregando a visão geral" className="flex flex-col gap-4">
    <SkeletonPanel
      title={consolidated ? 'Evolução das carteiras' : 'Evolução da carteira'}
    >
      <div className="flex flex-col gap-2 pb-3">
        <SkeletonBar className="h-2.5 w-40" />
        <SkeletonBar className="h-8 w-56" />
        <SkeletonBar className="h-2.5 w-64" />
      </div>
      <SkeletonChart />
    </SkeletonPanel>
    <div className={`grid grid-cols-1 items-stretch gap-4 ${TWO_COLUMNS}`}>
      <SkeletonPanel title="Alocação por classe">
        <SkeletonTable rows={4} columns={5} />
      </SkeletonPanel>
      <SkeletonPanel title="Carteiras">
        <SkeletonTable rows={3} columns={5} />
      </SkeletonPanel>
    </div>
    <div className={`grid grid-cols-1 items-stretch gap-4 ${TWO_COLUMNS}`}>
      <SkeletonPanel title="Maiores posições">
        <SkeletonTable rows={5} columns={3} />
      </SkeletonPanel>
      <SkeletonPanel title={consolidated ? 'Objetivos' : 'Objetivo'}>
        <SkeletonTable rows={2} columns={4} />
      </SkeletonPanel>
    </div>
    <SkeletonPanel title="Retorno × benchmarks">
      <div className="flex flex-col gap-4 py-1">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="grid grid-cols-[10rem_1fr_4rem] items-center gap-4">
            <SkeletonBar className="h-3 w-24" />
            <SkeletonBar className="h-2.5 w-full" />
            <SkeletonBar className="ml-auto h-3 w-12" />
          </div>
        ))}
      </div>
    </SkeletonPanel>
  </SkeletonRegion>
);

/** As duas colunas das pranchas 1.3 e 1.4, da mesma largura. */
const TWO_COLUMNS = 'lg:grid-cols-2';

const ReturnsFailed = ({
  error,
  onRetry,
}: {
  readonly error: Error;
  readonly onRetry: () => void;
}): React.ReactElement => (
  <p
    role="alert"
    className="flex flex-wrap items-center gap-3 p-4 text-[0.8125rem] text-negative"
  >
    <span>Não foi possível carregar o retorno: {error.message}</span>
    <button
      type="button"
      className="h-control cursor-pointer rounded-control border border-line px-3 text-ink hover:bg-panel-2"
      onClick={onRetry}
    >
      Tentar novamente
    </button>
  </p>
);

/** O retorno contra benchmarks, em gráfico próprio e percentual. */
const ReturnsCard = ({
  performance,
  portfolioReturns,
  extraIds,
  onExtraIdsChange,
  period,
  periodFrom,
  compare,
}: {
  readonly compare: boolean;
  readonly performance: Resource<PerformanceResource>;
  readonly portfolioReturns: readonly PortfolioReturn[] | null;
  readonly periodFrom: DateOnly;
  readonly extraIds: readonly string[];
  readonly onExtraIdsChange: (ids: readonly string[]) => void;
  readonly period: Period;
}): React.ReactElement => {
  const { state, reload } = performance;

  return (
    <Panel
      title="Retorno × benchmarks"
      action={
        <span className="flex items-baseline gap-3">
          <span className="text-xs text-ink-3">
            {periodSuffix(period)} · pela cota · nada anualizado
          </span>
          {state.kind === 'ready' ? (
            <ReturnsBenchmarkAction
              data={state.value}
              extraIds={extraIds}
              onExtraIdsChange={onExtraIdsChange}
            />
          ) : null}
        </span>
      }
      id="retorno-benchmarks"
      className="scroll-mt-4"
    >
      <div
        className={
          state.kind === 'ready' && state.value.reference_date !== null ? '' : 'p-4'
        }
      >
        {state.kind === 'loading' ? (
          <SkeletonRegion label="Carregando o retorno">
            <SkeletonChart />
          </SkeletonRegion>
        ) : state.kind === 'error' ? (
          <ReturnsFailed error={state.error} onRetry={reload} />
        ) : state.value.reference_date === null ? (
          <p className="text-[0.8125rem] text-ink-3">Sem consolidação no período.</p>
        ) : (
          <ReturnsBars
            data={state.value}
            extraIds={extraIds}
            onExtraIdsChange={onExtraIdsChange}
            portfolios={portfolioReturns}
            compare={compare}
            periodFrom={periodFrom}
          />
        )}
      </div>
    </Panel>
  );
};

export const OverviewView = ({
  portfolioId: requested,
  resource,
  performance,
  portfolioReturns = null,
  goals = null,
  portfoliosPerformance = null,
  period,
  onPeriodChange,
  extraIds,
  onExtraIdsChange,
  today,
}: OverviewViewProps): React.ReactElement => {
  const { state, pending, reload } = resource;
  const { hidden, toggleHidden } = usePreferences();
  const shared = usePortfolios();
  const entry = useEntry();
  const openEntry = entry.openEntry;

  // VGR-17.3: N lança e F leva o foco ao período, que é o filtro desta tela.
  const shortcuts = useMemo(
    () => ({
      new_transaction: () => openEntry(),
      filter: () =>
        document.querySelector<HTMLElement>('button[aria-label^="Período:"]')?.focus(),
    }),
    [openEntry],
  );
  useShortcuts(shortcuts);

  if (state.kind === 'error') return <Failed error={state.error} onRetry={reload} />;

  const overview = state.kind === 'ready' ? state.value : null;
  const portfolioId = overview?.scope.portfolio_id ?? requested ?? null;
  const inception = overview?.scope.inception ?? null;

  const subtitle =
    overview === null
      ? 'Investimentos'
      : [
          'Investimentos',
          overview.scope.portfolio_id === null
            ? 'todas as carteiras'
            : overview.scope.name,
          overview.reference_date === null
            ? null
            : `consolidação de ${formatDate(overview.reference_date as DateOnly)}`,
        ]
          .filter((part): part is string => part !== null && part !== '')
          .join(' · ');

  const header = (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-screen-title leading-7 font-semibold">Visão geral</h1>
        <p className="truncate text-xs text-ink-3">{subtitle}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <HomeScopeControl scope="investimentos" portfolioId={portfolioId} />
        <PeriodControl
          value={period}
          onChange={onPeriodChange}
          today={today}
          inception={inception as DateOnly | null}
        />
        {/* Abrir a tela ao lado de outra pessoa é um caso de uso real: o
              modo esconde o número e preserva o layout e o sinal. */}
        <IconButton
          label={hidden ? 'Mostrar valores' : 'Ocultar valores'}
          aria-pressed={hidden}
          onClick={toggleHidden}
        >
          <Icon name={hidden ? 'eye-off' : 'eye'} />
        </IconButton>
        <Button
          variant="primary"
          icon="plus"
          shortcut="N"
          onClick={() => entry.openEntry()}
        >
          Movimentação
        </Button>
      </div>
    </header>
  );

  if (overview === null) {
    return (
      <div className="flex flex-col gap-4">
        {header}
        <Skeleton consolidated={portfolioId === null} />
      </div>
    );
  }

  const scopeSlug =
    overview.scope.portfolio_id === null
      ? ALL_SCOPE
      : (shared.slugs.get(overview.scope.portfolio_id) ?? ALL_SCOPE);

  return (
    <div className="flex flex-col gap-4">
      {header}

      {overview.reference_date === null ? (
        <Empty scope={overview.scope.name} />
      ) : (
        <KeepPrevious pending={pending} className="flex flex-col gap-4">
          <EvolucaoPanel
            title={
              overview.scope.portfolio_id === null
                ? 'Evolução das carteiras'
                : 'Evolução da carteira'
            }
            label={
              overview.scope.portfolio_id === null
                ? 'Patrimônio · todas as carteiras'
                : `Patrimônio · ${overview.scope.name}`
            }
            windowLabel={windowLabel(period)}
            scopeHint={overview.scope.name}
            overview={resource}
          />

          <div className={`grid grid-cols-1 items-stretch gap-4 ${TWO_COLUMNS}`}>
            <AlocacaoPanel
              overview={overview}
              performance={
                performance !== null && performance.state.kind === 'ready'
                  ? performance.state.value
                  : null
              }
              hint={
                overview.scope.portfolio_id === null
                  ? 'somando as carteiras'
                  : overview.scope.name
              }
              classHref={(id) =>
                `${routes.portfolio(scopeSlug, 'posicoes')}?classe=${encodeURIComponent(id)}`
              }
            />
            <CarteirasPanel
              performance={
                portfoliosPerformance !== null &&
                portfoliosPerformance.state.kind === 'ready'
                  ? portfoliosPerformance.state.value
                  : null
              }
              total={shared.total ?? overview.totals.value ?? '0.00'}
              referenceDate={overview.reference_date}
              selectedId={overview.scope.portfolio_id}
              selectedName={
                overview.scope.portfolio_id === null ? null : overview.scope.name
              }
              portfolioHref={(id) =>
                routes.home('investimentos', shared.slugs.get(id) ?? ALL_SCOPE)
              }
            />
          </div>

          <div className={`grid grid-cols-1 items-stretch gap-4 ${TWO_COLUMNS}`}>
            <PosicoesPanel
              overview={overview}
              allHref={routes.portfolio(scopeSlug, 'posicoes')}
              assetHref={(slug) => routes.asset(scopeSlug, slug)}
            />
            <ObjetivosPanel
              goals={goals ?? NO_GOALS}
              portfolioId={overview.scope.portfolio_id}
              seeHref={routes.portfolio(scopeSlug, 'objetivos')}
              defineHref={routes.portfolio(scopeSlug, 'objetivos')}
            />
          </div>

          {performance === null ? null : (
            <ReturnsCard
              compare={overview.scope.portfolio_id === null}
              performance={performance}
              portfolioReturns={
                portfolioReturns?.state.kind === 'ready'
                  ? portfolioReturns.state.value
                  : null
              }
              extraIds={extraIds}
              onExtraIdsChange={onExtraIdsChange}
              period={returnsPeriod(today, inception as DateOnly | null)}
              periodFrom={
                resolvePeriod(
                  returnsPeriod(today, inception as DateOnly | null),
                  today,
                  inception as DateOnly | null,
                ).from as DateOnly
              }
            />
          )}
        </KeepPrevious>
      )}
    </div>
  );
};
