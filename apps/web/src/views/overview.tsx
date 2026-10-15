import type {
  OverviewResource,
  OverviewTopPositionResource,
  PerformanceResource,
} from '@patrimonio/contracts';
import type { DateOnly } from '@patrimonio/domain';
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';

import { fetchOverview } from '../api/overview.js';
import { fetchPerformance } from '../api/performance.js';

import { useEntry } from '../components/entry_provider.js';
import { Money, MoneyChange, Percent, PercentChange } from '../components/number.js';
import { OverviewHeader } from '../components/overview_header.js';
import { KeepPrevious } from '../components/pending.js';
import { PeriodControl } from '../components/period_control.js';
import { usePreferences } from '../components/preferences.js';
import { Button, IconButton, Panel, PriceHealthDot } from '../components/primitives.js';
import { SeriesChart } from '../components/series_chart.js';
import { assetSlug, assetTitle } from '../lib/asset_page.js';
import type { Period } from '../lib/period.js';
import {
  DEFAULT_PERIOD,
  PERIOD_LABELS,
  decodePeriod,
  encodePeriod,
  formatDayMonth,
  resolvePeriod,
} from '../lib/period.js';
import {
  CONTRIBUTIONS_COLOR,
  formatDate,
  growthBands,
  monthLabel,
  monthTicks,
  percentAsRatio,
  resultColor,
} from '../lib/overview.js';
import type { Resource } from '../lib/use_resource.js';
import { useResource } from '../lib/use_resource.js';
import { SEMANTIC_COLORS, colorForToken } from '../lib/tokens.js';
import { listParam, readParams, writeParams } from '../lib/url_state.js';
import { Icon } from '../components/icon.js';
import { ClassesTable } from './overview_classes.js';
import { PortfoliosTable } from './overview_portfolios.js';
import { ReturnsChart } from './overview_returns.js';
import {
  SkeletonChart,
  SkeletonHeader,
  SkeletonPanel,
  SkeletonRegion,
  SkeletonStats,
  SkeletonTable,
} from '../components/skeleton.js';

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
  readonly resource: Resource<OverviewResource>;
  /**
   * O retorno contra benchmarks: gráfico, janelas e classes. Nulo quando a
   * leitura não foi pedida; a tela então mostra só o que não depende dela.
   */
  readonly performance: Resource<PerformanceResource> | null;
  readonly period: Period;
  readonly onPeriodChange: (period: Period) => void;
  /** Os benchmarks pedidos além do da carteira, que a URL guarda. */
  readonly extraIds: readonly string[];
  readonly onExtraIdsChange: (ids: readonly string[]) => void;
  readonly today: DateOnly;
  readonly onOpenAsset?: ((slug: string) => void) | undefined;
  /** Leva a outra tela da carteira: `estrategia`, `posicoes`. */
  readonly onOpenScreen?: ((path: 'estrategia' | 'posicoes') => void) | undefined;
  /** Abre a Visão geral de uma carteira, a partir da distribuição por carteira. */
  readonly onOpenPortfolio?: ((portfolioId: string) => void) | undefined;
};

export type OverviewScreenProps = {
  /** Nulo é o escopo de todas as carteiras. */
  readonly portfolioId: string | null;
  /** Abre a página do ativo (T-03), pelo mesmo apelido que Posições usa. */
  readonly onOpenAsset?: ((slug: string) => void) | undefined;
  readonly onOpenScreen?: ((path: 'estrategia' | 'posicoes') => void) | undefined;
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

  const resource = useResource(
    (signal) => fetchOverview({ portfolioId, from: range.from, to: range.to }, signal),
    [portfolioId, range.from, range.to],
  );

  // Em Todas as carteiras a cota é reconstruída sobre a soma, e o benchmark é o
  // CDI (ou o que a pessoa escolher): nenhuma carteira dita o padrão.
  const performance = useResource(
    (signal) =>
      fetchPerformance(
        { portfolioId, from: range.from, to: range.to, benchmarks: extraIds },
        signal,
      ),
    [portfolioId, range.from, range.to, extraIds.join(',')],
  );

  useEffect(() => {
    if (resource.state.kind === 'ready') {
      setInception(resource.state.value.scope.inception as DateOnly | null);
    }
  }, [resource.state]);

  return (
    <OverviewView
      resource={resource}
      performance={performance}
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

const Evolution = ({
  overview,
}: {
  readonly overview: OverviewResource;
}): React.ReactElement => {
  const bands = growthBands(overview.series);
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
          label: bands.underwater ? 'Resultado acumulado' : 'Rendimento acumulado',
          color: resultColor(bands.underwater),
          values: bands.result,
        },
        ...(bands.hasPayouts
          ? [
              {
                id: 'proventos',
                label: 'Proventos recebidos',
                color: SEMANTIC_COLORS.payouts,
                values: bands.payouts,
              },
            ]
          : []),
      ]}
      valueFormat="money"
      fromZero
      ariaLabel="Evolução do patrimônio, separando aporte, rendimento e proventos"
      xTickLabel={(date) => ticks.get(date) ?? ''}
      tooltipDateLabel={(date) => formatDate(date)}
    />
  );
};

/** O link do cabeçalho de um cartão — `Estratégia →`, `Todas · 28 →`. */
const PanelLink = ({
  onClick,
  children,
}: {
  readonly onClick: () => void;
  readonly children: React.ReactNode;
}): React.ReactElement => (
  <button
    type="button"
    className="inline-flex cursor-pointer items-center gap-1 text-xs text-accent hover:underline"
    onClick={onClick}
  >
    {children}
    <Icon name="arrow-right" size={14} />
  </button>
);

const TopPositions = ({
  overview,
  onOpenAsset,
}: {
  readonly overview: OverviewResource;
  readonly onOpenAsset?: ((slug: string) => void) | undefined;
}): React.ReactElement => {
  const rows = overview.top_positions.rows;

  if (rows.length === 0) {
    return (
      <p className="p-4 text-[0.8125rem] text-ink-3">
        Nenhuma posição aberta. O primeiro lançamento começa a história da carteira.
      </p>
    );
  }

  return (
    <table className="w-full">
      <caption className="sr-only">Maiores posições</caption>
      <thead>
        <tr className="tabular border-b border-line text-label font-medium tracking-[0.06em] text-ink-3 uppercase">
          <th scope="col" className="px-4 py-[9px] text-left">
            Ativo
          </th>
          <th scope="col" className="px-4 py-[9px] text-right">
            Valor
          </th>
          <th scope="col" className="px-4 py-[9px] text-right">
            Peso
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row: OverviewTopPositionResource) => (
          <tr
            key={row.asset_id}
            className="border-b border-line text-[0.8125rem] last:border-b-0"
          >
            <th
              scope="row"
              className="truncate px-4 py-(--row-pad) text-left font-normal"
            >
              <span className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="size-2 shrink-0 rounded-xs"
                  style={{ backgroundColor: colorForToken(row.color_token) }}
                />
                {onOpenAsset === undefined ? (
                  <span title={row.name}>{assetTitle(row)}</span>
                ) : (
                  <button
                    type="button"
                    title={row.name}
                    className="cursor-pointer hover:text-accent"
                    onClick={() => onOpenAsset(assetSlug(row))}
                  >
                    {assetTitle(row)}
                  </button>
                )}
                <PriceHealthDot kind={row.price_source_kind} />
              </span>
            </th>
            <td className="px-4 py-(--row-pad) text-right">
              <Money value={row.value} decimals={2} />
            </td>
            <td className="px-4 py-(--row-pad) text-right">
              <Percent value={percentAsRatio(row.weight_pct)} decimals={1} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};

const Empty = ({ scope }: { readonly scope: string }): React.ReactElement => (
  <section className="rounded-panel border border-line bg-panel p-8 text-center">
    <h2 className="text-panel-title font-semibold">Carteira ainda não consolidada</h2>
    <p className="mx-auto mt-2 max-w-prose text-[0.8125rem] text-ink-2">
      {scope} não tem posição calculada. O primeiro lançamento começa a história: a
      consolidação do dia roda em seguida e esta tela passa a responder quanto você tem.
    </p>
  </section>
);

const Failed = ({
  error,
  onRetry,
}: {
  readonly error: Error;
  readonly onRetry: () => void;
}): React.ReactElement => (
  <section
    role="alert"
    className="rounded-panel border border-line bg-panel p-8 text-center"
  >
    <h2 className="text-panel-title font-semibold text-negative">
      A tela não pôde ser carregada
    </h2>
    {/* Erro nunca vira "nenhum resultado": uma tela vazia porque a api caiu é
        a pior mentira que uma tela financeira conta. */}
    <p className="mx-auto mt-2 max-w-prose text-[0.8125rem] text-ink-2">
      {error.message}
    </p>
    <button
      type="button"
      className="mt-4 h-control cursor-pointer rounded-control border border-line px-3 text-[0.8125rem] hover:bg-panel-2"
      onClick={onRetry}
    >
      Tentar de novo
    </button>
  </section>
);

const Skeleton = (): React.ReactElement => (
  <SkeletonRegion label="Carregando a visão geral" className="flex flex-col gap-4">
    <SkeletonHeader />
    <SkeletonStats count={4} />
    <SkeletonPanel>
      <SkeletonChart />
    </SkeletonPanel>
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <SkeletonPanel title="Carteiras">
        <SkeletonTable rows={4} columns={3} />
      </SkeletonPanel>
      <SkeletonPanel title="Classes de ativo">
        <SkeletonTable rows={4} columns={3} />
      </SkeletonPanel>
    </div>
    <SkeletonPanel title="Maiores posições">
      <SkeletonTable rows={5} columns={4} />
    </SkeletonPanel>
  </SkeletonRegion>
);

/** O gráfico do cabeçalho: aporte e rendimento em reais, empilhados. */
const EvolutionCard = ({
  overview,
  period,
  today,
}: {
  readonly overview: OverviewResource;
  readonly period: Period;
  readonly today: DateOnly;
}): React.ReactElement => {
  const range = resolvePeriod(period, today, overview.scope.inception as DateOnly | null);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h2 className="text-panel-title font-semibold">
          Evolução {periodSuffix(period)}
        </h2>
        <span className="text-[0.75rem] text-ink-3">
          {formatDayMonth(range.from, today)} – {formatDayMonth(range.to, today)}
        </span>
      </div>
      <Evolution overview={overview} />
    </div>
  );
};

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
      Tentar de novo
    </button>
  </p>
);

/** O retorno contra benchmarks, em gráfico próprio e percentual. */
const ReturnsCard = ({
  performance,
  extraIds,
  onExtraIdsChange,
  period,
}: {
  readonly performance: Resource<PerformanceResource>;
  readonly extraIds: readonly string[];
  readonly onExtraIdsChange: (ids: readonly string[]) => void;
  readonly period: Period;
}): React.ReactElement => {
  const { state, reload } = performance;

  return (
    <Panel
      title={`Retorno × benchmarks ${periodSuffix(period)}`}
      hint="pela cota · base 0% · nada anualizado"
    >
      <div className="p-4">
        {state.kind === 'loading' ? (
          <SkeletonRegion label="Carregando o retorno">
            <SkeletonChart />
          </SkeletonRegion>
        ) : state.kind === 'error' ? (
          <ReturnsFailed error={state.error} onRetry={reload} />
        ) : state.value.reference_date === null ? (
          <p className="text-[0.8125rem] text-ink-3">Sem consolidação no período.</p>
        ) : (
          <ReturnsChart
            data={state.value}
            extraIds={extraIds}
            onExtraIdsChange={onExtraIdsChange}
          />
        )}
      </div>
    </Panel>
  );
};

export const OverviewView = ({
  resource,
  performance,
  period,
  onPeriodChange,
  extraIds,
  onExtraIdsChange,
  today,
  onOpenAsset,
  onOpenScreen,
  onOpenPortfolio,
}: OverviewViewProps): React.ReactElement => {
  const { state, pending, reload } = resource;
  const { hidden, toggleHidden } = usePreferences();
  const entry = useEntry();

  if (state.kind === 'loading') return <Skeleton />;
  if (state.kind === 'error') return <Failed error={state.error} onRetry={reload} />;

  const overview = state.value;
  const inception = overview.scope.inception;

  const subtitle = [
    overview.scope.name,
    overview.reference_date === null
      ? null
      : `consolidação de ${formatDate(overview.reference_date as DateOnly)}`,
  ]
    .filter((part): part is string => part !== null && part !== '')
    .join(' · ');

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-screen-title leading-7 font-semibold">Visão geral</h1>
          <p className="truncate text-xs text-ink-3">{subtitle}</p>
        </div>

        <div className="flex items-center gap-2">
          <PeriodControl
            value={period}
            onChange={onPeriodChange}
            today={today}
            inception={inception}
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
            Lançamento
          </Button>
        </div>
      </header>

      {overview.reference_date === null ? (
        <Empty scope={overview.scope.name} />
      ) : (
        <KeepPrevious pending={pending} className="flex flex-col gap-4">
          <OverviewHeader
            label={
              overview.scope.portfolio_id === null
                ? 'Patrimônio · todas as carteiras'
                : 'Valor da carteira'
            }
            principal={overview.totals.value}
            {...(overview.totals.month === null
              ? {}
              : {
                  change: {
                    amount: overview.totals.month.amount,
                    ratio: percentAsRatio(overview.totals.month.ratio),
                    periodLabel: monthLabel(overview.reference_date as DateOnly),
                  },
                })}
            {...(overview.scope.recalc_status === 'running' ||
            overview.scope.recalc_status === 'queued'
              ? { caveat: 'recalculando: o número é o do última consolidação concluída' }
              : {})}
            metrics={[
              {
                label: `Rentabilidade ${periodSuffix(period)}`,
                value: (
                  <PercentChange value={percentAsRatio(overview.period.return_pct)} />
                ),
              },
              {
                label: `Aportes ${periodSuffix(period)}`,
                value: <Money value={overview.period.contributions} />,
              },
              {
                label: `Rendimento ${periodSuffix(period)}`,
                value: <MoneyChange value={overview.period.income} />,
              },
              {
                label: 'Variação do dia',
                value: <MoneyChange value={overview.totals.day?.amount ?? null} />,
              },
            ]}
            chart={<EvolutionCard overview={overview} period={period} today={today} />}
          />

          {overview.scope.portfolio_id === null ? (
            <Panel
              title="Distribuição por carteira"
              hint="peso e retorno pela cota de cada carteira"
              className="flex flex-col"
            >
              <PortfoliosTable
                overview={overview}
                performance={
                  performance !== null && performance.state.kind === 'ready'
                    ? performance.state.value
                    : null
                }
                {...(onOpenPortfolio === undefined ? {} : { onOpenPortfolio })}
              />
            </Panel>
          ) : null}

          {performance === null ? null : (
            <ReturnsCard
              performance={performance}
              extraIds={extraIds}
              onExtraIdsChange={onExtraIdsChange}
              period={period}
            />
          )}

          <Panel
            title="Por classe de ativo"
            hint={
              overview.scope.portfolio_id === null
                ? 'peso e retorno somando as carteiras · Dietz modificado, a classe não tem cota'
                : 'peso, alvo e retorno · Dietz modificado, a classe não tem cota'
            }
            className="flex flex-col"
            action={
              onOpenScreen === undefined ||
              overview.scope.portfolio_id === null ? undefined : (
                <PanelLink onClick={() => onOpenScreen('estrategia')}>
                  Estratégia
                </PanelLink>
              )
            }
          >
            <ClassesTable
              overview={overview}
              performance={
                performance !== null && performance.state.kind === 'ready'
                  ? performance.state.value
                  : null
              }
            />
          </Panel>

          <Panel
            title="Maiores posições"
            className="flex flex-col"
            action={
              onOpenScreen === undefined ? undefined : (
                <PanelLink onClick={() => onOpenScreen('posicoes')}>
                  Todas · {overview.top_positions.total_count}
                </PanelLink>
              )
            }
          >
            <TopPositions
              overview={overview}
              {...(onOpenAsset === undefined ? {} : { onOpenAsset })}
            />
          </Panel>
        </KeepPrevious>
      )}
    </div>
  );
};
