import type {
  OverviewAttentionItemResource,
  OverviewResource,
  OverviewTopPositionResource,
} from '@patrimonio/contracts';
import type { DateOnly } from '@patrimonio/domain';
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';

import { fetchOverview } from '../api/overview.js';

import { CompositionBar } from '../components/bars.js';
import {
  Money,
  MoneyChange,
  Percent,
  PercentChange,
  Points,
} from '../components/number.js';
import { OverviewHeader } from '../components/overview_header.js';
import { KeepPrevious } from '../components/pending.js';
import { PeriodControl } from '../components/period_control.js';
import { usePreferences } from '../components/preferences.js';
import { Chip, IconButton, Label, Panel, PriceHealthDot } from '../components/primitives.js';
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
  GROUP_LABELS,
  attentionText,
  formatDate,
  growthBands,
  monthLabel,
  monthTicks,
  percentAsRatio,
  resultColor,
  trimDecimals,
} from '../lib/overview.js';
import type { Resource } from '../lib/use_resource.js';
import { useResource } from '../lib/use_resource.js';
import { colorForToken } from '../lib/tokens.js';

/**
 * T-01 · Visão geral — a prancha `04 · Visão geral`.
 *
 * A tela responde duas perguntas, nessa ordem: **quanto eu tenho hoje** e **o
 * que precisa de mim**. A ordem é o layout inteiro. O patrimônio e a variação
 * abrem a tela porque é a pergunta que faz a pessoa entrar; o que exige ação
 * fica por último porque é o que a faz sair — e some da tela quando não há
 * nada pendente, em vez de anunciar que está tudo bem.
 *
 * Nada aqui faz conta com dinheiro. Peso, desvio, variação e rentabilidade
 * chegam prontos da `api`; o que a tela faz com eles é escolher a cor, a casa
 * decimal e a ordem — e `percentAsRatio` move a vírgula sobre a string, sem
 * passar por `number`.
 */
export type OverviewViewProps = {
  readonly resource: Resource<OverviewResource>;
  readonly period: Period;
  readonly onPeriodChange: (period: Period) => void;
  readonly today: DateOnly;
  readonly onOpenAsset?: ((slug: string) => void) | undefined;
};

export type OverviewScreenProps = {
  readonly portfolioId: string;
  /** Abre a página do ativo (T-03), pelo mesmo apelido que Posições usa. */
  readonly onOpenAsset?: ((slug: string) => void) | undefined;
};

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
}: OverviewScreenProps): React.ReactElement => {
  const [params, setParams] = useSearchParams();
  const today = todayIso();

  const period = decodePeriod(params.get('periodo'));

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

  useEffect(() => {
    if (resource.state.kind === 'ready') {
      setInception(resource.state.value.scope.inception as DateOnly | null);
    }
  }, [resource.state]);

  return (
    <OverviewView
      resource={resource}
      period={period}
      onPeriodChange={onPeriodChange}
      today={today}
      {...(onOpenAsset === undefined ? {} : { onOpenAsset })}
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
        Sem fechamento no período escolhido.
      </p>
    );
  }

  return (
    <SeriesChart
      dates={bands.dates}
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
      ]}
      valueFormat="money"
      fromZero
      ariaLabel="Evolução do patrimônio, separando aporte de rendimento"
      xTickLabel={(date) => ticks.get(date) ?? ''}
      tooltipDateLabel={(date) => formatDate(date)}
    />
  );
};

const Distribution = ({
  overview,
}: {
  readonly overview: OverviewResource;
}): React.ReactElement => {
  const nodes = overview.composition.nodes;

  if (nodes.length === 0) {
    return (
      <p className="p-4 text-[0.8125rem] text-ink-3">
        Sem posição em carteira na data do fechamento.
      </p>
    );
  }

  const slices = nodes.map((node) => ({
    id: node.id,
    label: node.name,
    colorToken: node.color_token,
    share: percentAsRatio(node.current_pct),
  }));

  const withTarget = nodes.filter((node) => node.target_pct !== null);
  const out = withTarget.filter((node) => node.over_tolerance);

  return (
    <div className="flex flex-col gap-3 p-4">
      <CompositionBar slices={slices} label="Composição por categoria" />

      <table className="w-full">
        <caption className="sr-only">Distribuição por categoria</caption>
        <thead>
          <tr className="text-label tracking-wide text-ink-3 uppercase">
            <th scope="col" className="pb-1 text-left font-medium">
              Classe
            </th>
            <th scope="col" className="pb-1 text-right font-medium">
              Atual
            </th>
            <th scope="col" className="pb-1 text-right font-medium">
              vs alvo
            </th>
          </tr>
        </thead>
        <tbody>
          {nodes.map((node) => (
            <tr
              key={node.id}
              className="h-(--row-height) border-t border-line text-[0.8125rem]"
            >
              <th scope="row" className="truncate text-left font-normal">
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="size-2 shrink-0 rounded-xs"
                    style={{ backgroundColor: colorForToken(node.color_token) }}
                  />
                  {node.name}
                </span>
              </th>
              <td className="text-right">
                <Percent value={percentAsRatio(node.current_pct)} decimals={1} />
              </td>
              <td className="text-right">
                <Points
                  value={node.deviation_pp}
                  decimals={1}
                  tone={node.over_tolerance ? 'attention' : 'muted'}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="text-[0.75rem] text-ink-3">
        {withTarget.length === 0
          ? 'Nenhum alvo declarado: a estratégia desta carteira ainda não foi definida.'
          : out.length === 0
            ? `Todas as classes dentro da tolerância de ${trimDecimals(overview.scope.tolerance_pp)} pp.`
            : `${out.length} ${out.length === 1 ? 'classe fora' : 'classes fora'} da tolerância de ${trimDecimals(overview.scope.tolerance_pp)} pp.`}
      </p>
    </div>
  );
};

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
    <table className="w-full px-4">
      <caption className="sr-only">Maiores posições</caption>
      <thead>
        <tr className="text-label tracking-wide text-ink-3 uppercase">
          <th scope="col" className="px-4 pb-1 text-left font-medium">
            Ativo
          </th>
          <th scope="col" className="px-4 pb-1 text-right font-medium">
            Valor
          </th>
          <th scope="col" className="px-4 pb-1 text-right font-medium">
            Peso
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row: OverviewTopPositionResource) => (
          <tr
            key={row.asset_id}
            className="h-(--row-height) border-t border-line text-[0.8125rem]"
          >
            <th scope="row" className="truncate px-4 text-left font-normal">
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
            <td className="px-4 text-right">
              <Money value={row.value} decimals={2} />
            </td>
            <td className="px-4 text-right">
              <Percent value={percentAsRatio(row.weight_pct)} decimals={1} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};

const AttentionRow = ({
  item,
  portfolioName,
}: {
  readonly item: OverviewAttentionItemResource;
  readonly portfolioName: string | null;
}): React.ReactElement => {
  const text = attentionText(item);

  return (
    <li className="flex items-center gap-3 border-t border-line px-4 py-2.5 text-[0.8125rem]">
      <span className="min-w-0 flex-1 truncate">
        <span className="font-medium">{text.title}</span>
        <span className="text-ink-3"> · </span>
        <span className="text-ink-2">{text.detail}</span>
      </span>
      {portfolioName === null ? null : <Chip>{portfolioName}</Chip>}
    </li>
  );
};

const Attention = ({
  overview,
}: {
  readonly overview: OverviewResource;
}): React.ReactElement | null => {
  // Nenhum bloco aparece vazio: sem pendência, o painel sai da tela.
  if (overview.attention.groups.length === 0) return null;

  const nameOf = (portfolioId: string | null): string | null =>
    portfolioId === null ? null : overview.scope.name;

  return (
    <Panel
      title={`Requer atenção · ${overview.attention.total}`}
      hint={overview.attention.groups
        .map((group) => `${GROUP_LABELS[group.group]} ${group.count}`)
        .join(' · ')}
    >
      {overview.attention.groups.map((group) => (
        <section key={group.group}>
          <header className="bg-panel-2 px-4 py-1.5">
            <Label>{`${GROUP_LABELS[group.group]} · ${group.count}`}</Label>
          </header>
          <ul>
            {group.items.map((item) => (
              <AttentionRow
                key={`${item.rule_kind}:${item.subject_id}`}
                item={item}
                portfolioName={nameOf(item.portfolio_id)}
              />
            ))}
          </ul>
        </section>
      ))}
    </Panel>
  );
};

const Empty = ({ scope }: { readonly scope: string }): React.ReactElement => (
  <section className="rounded-panel border border-line bg-panel p-8 text-center">
    <h2 className="text-panel-title font-semibold">Nenhum fechamento ainda</h2>
    <p className="mx-auto mt-2 max-w-prose text-[0.8125rem] text-ink-2">
      {scope} não tem posição calculada. O primeiro lançamento começa a história: o
      fechamento do dia roda em seguida e esta tela passa a responder quanto você tem.
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
    <p className="mx-auto mt-2 max-w-prose text-[0.8125rem] text-ink-2">{error.message}</p>
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
  <p aria-busy="true" className="p-8 text-center text-[0.8125rem] text-ink-3">
    Carregando a visão geral…
  </p>
);

export const OverviewView = ({
  resource,
  period,
  onPeriodChange,
  today,
  onOpenAsset,
}: OverviewViewProps): React.ReactElement => {
  const { state, pending, reload } = resource;
  const { hidden, toggleHidden } = usePreferences();

  if (state.kind === 'loading') return <Skeleton />;
  if (state.kind === 'error') return <Failed error={state.error} onRetry={reload} />;

  const overview = state.value;
  const inception = overview.scope.inception;
  const range = resolvePeriod(period, today, inception);

  const subtitle = [
    overview.scope.name,
    overview.scope.purpose,
    overview.reference_date === null
      ? null
      : `fechamento de ${formatDate(overview.reference_date as DateOnly)}`,
  ]
    .filter((part): part is string => part !== null && part !== '')
    .join(' · ');

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-screen-title font-semibold tracking-tight">Visão geral</h1>
          <p className="truncate text-[0.8125rem] text-ink-2">{subtitle}</p>
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
            <span aria-hidden="true">{hidden ? '◌' : '◉'}</span>
          </IconButton>
        </div>
      </header>

      {overview.reference_date === null ? (
        <Empty scope={overview.scope.name} />
      ) : (
        <KeepPrevious pending={pending} className="flex flex-col gap-4">
          <OverviewHeader
            label="Valor da carteira"
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
              ? { caveat: 'recalculando: o número é o do último fechamento concluído' }
              : {})}
            metrics={[
              {
                label: `Rentabilidade ${periodSuffix(period)}`,
                value: <PercentChange value={percentAsRatio(overview.period.return_pct)} />,
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
            chart={
              <div className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between gap-3">
                  <h2 className="text-panel-title font-semibold">
                    Evolução {periodSuffix(period)}
                  </h2>
                  <span className="text-[0.75rem] text-ink-3">
                    {formatDayMonth(range.from, today)} – {formatDayMonth(range.to, today)}
                  </span>
                </div>
                <Evolution overview={overview} />
              </div>
            }
          />

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Panel
              title="Distribuição por categoria"
            >
              <Distribution overview={overview} />
            </Panel>

            <Panel
              title="Maiores posições"
              hint={`${overview.top_positions.total_count} no total`}
            >
              <div className="p-4">
                <TopPositions
                  overview={overview}
                  {...(onOpenAsset === undefined ? {} : { onOpenAsset })}
                />
              </div>
            </Panel>
          </div>

          <Attention overview={overview} />
        </KeepPrevious>
      )}
    </div>
  );
};
