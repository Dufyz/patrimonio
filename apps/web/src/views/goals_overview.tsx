import type { GoalsOverviewResource } from '@patrimonio/contracts';
import type { DateOnly } from '@patrimonio/domain';
import { useCallback } from 'react';
import { useSearchParams } from 'react-router';

import { fetchGoalsOverview } from '../api/goals.js';
import { Icon } from '../components/icon.js';
import { Money, Percent } from '../components/number.js';
import { KeepPrevious } from '../components/pending.js';
import { usePreferences } from '../components/preferences.js';
import { Button, IconButton, Panel } from '../components/primitives.js';
import { SeriesChart } from '../components/series_chart.js';
import {
  SkeletonChart,
  SkeletonHeader,
  SkeletonPanel,
  SkeletonRegion,
  SkeletonTable,
} from '../components/skeleton.js';
import { formatCompact } from '../lib/format.js';
import { STATUS_LABEL, barState, latenessOf, monthYearLabel } from '../lib/goals.js';
import {
  EXCLUSION_LABEL,
  SCENARIO_LABEL,
  againstDeadline,
  decodeBudget,
  decodeCascade,
  overviewBadge,
  overviewSeries,
  sortRows,
} from '../lib/goals_overview.js';
import type { Rates } from '../lib/goal_rates.js';
import { useGoalRates } from '../lib/goal_rates.js';
import { monthTicks, percentAsRatio } from '../lib/overview.js';
import type { Resource } from '../lib/use_resource.js';
import { useResource } from '../lib/use_resource.js';
import { BudgetForm } from './budget_form.js';
import { RatesPanel, percentText } from './rates_panel.js';
import { Fact, ScenarioCells, Stat, scenarioRow } from './goals.js';

/**
 * T-07 · Objetivos em "Todas as carteiras" — a prancha `18C`.
 *
 * Um panorama: cada carteira tem o seu objetivo, e a pergunta é "quanto preciso
 * aportar por mês, no total e em cada carteira, para bater todas as metas, e
 * quando isso acontece". Criar, editar e excluir continuam dentro da carteira;
 * clicar numa linha leva até lá.
 *
 * Nada aqui faz conta: somas, fatias, datas e o plano de aportes chegam
 * prontos da `api`. O orçamento e a cascata vivem na URL — são da sessão, nunca gravados.
 */
type Overview = GoalsOverviewResource;
type OverviewRow = Overview['portfolios'][number];

export type GoalsOverviewChange = {
  readonly budget?: string | null;
  readonly cascade?: boolean;
};

export type GoalsOverviewViewProps = {
  readonly resource: Resource<Overview>;
  readonly budget: string | null;
  readonly cascade: boolean;
  readonly rates: Rates;
  readonly onRateChange: (portfolioId: string, rate: string | null) => void;
  readonly onChange: (change: GoalsOverviewChange) => void;
  readonly onOpenPortfolio: (portfolioId: string) => void;
};

export type GoalsOverviewScreenProps = {
  readonly onOpenPortfolio: (portfolioId: string) => void;
};

export const GoalsOverviewScreen = ({
  onOpenPortfolio,
}: GoalsOverviewScreenProps): React.ReactElement => {
  const [params, setParams] = useSearchParams();

  const budget = decodeBudget(params.get('aporte'));
  const cascade = decodeCascade(params.get('cascata'));
  const { rates, setRate } = useGoalRates();

  const onChange = useCallback(
    (change: GoalsOverviewChange) =>
      setParams(
        (current) => {
          const search = new URLSearchParams(current);

          if (change.budget !== undefined) {
            if (change.budget === null) search.delete('aporte');
            else search.set('aporte', change.budget);
          }
          if (change.cascade !== undefined) {
            if (change.cascade) search.delete('cascata');
            else search.set('cascata', '0');
          }
          return search;
        },
        { replace: true },
      ),
    [setParams],
  );

  const resource = useResource(
    (signal) =>
      fetchGoalsOverview(
        {
          budget,
          cascade,
          rates,
        },
        signal,
      ),
    [budget, cascade, JSON.stringify(rates)],
  );

  return (
    <GoalsOverviewView
      resource={resource}
      budget={budget}
      cascade={cascade}
      rates={rates}
      onRateChange={setRate}
      onChange={onChange}
      onOpenPortfolio={onOpenPortfolio}
    />
  );
};

/* -------------------------------------------------------------------------- */

const Badge = ({
  tone,
  children,
}: {
  readonly tone: 'positive' | 'attention' | 'negative' | 'neutral';
  readonly children: React.ReactNode;
}): React.ReactElement => (
  <span
    className={`rounded-[4px] px-2 py-0.5 text-[0.71875rem] font-medium whitespace-nowrap ${
      tone === 'positive'
        ? 'bg-positive-soft text-positive'
        : tone === 'neutral'
          ? 'bg-panel-2 text-ink-2'
          : 'bg-attention-soft text-attention'
    }`}
  >
    {children}
  </span>
);

const Track = ({
  progress,
  expected,
  state,
  label,
}: {
  readonly progress: string;
  readonly expected: string | null;
  readonly state: 'on_track' | 'behind' | 'reached';
  readonly label: string;
}): React.ReactElement => {
  const done = Math.min(100, Math.max(0, Number(progress)));
  const mark = expected === null ? null : Math.min(100, Math.max(0, Number(expected)));

  return (
    <span
      role="img"
      aria-label={label}
      className="relative block h-2 rounded-[4px] bg-panel-2 shadow-[inset_0_0_0_1px_var(--color-line)]"
    >
      <span
        aria-hidden="true"
        className={`absolute inset-y-0 left-0 rounded-[4px] ${
          state === 'reached' ? 'bg-positive' : 'bg-accent'
        }`}
        style={{ width: `${done}%` }}
      />
      {mark === null ? null : (
        <span
          aria-hidden="true"
          title="onde deveria estar hoje"
          className="absolute -top-[3px] h-3.5 w-0.5 bg-ink"
          style={{ left: `${mark}%` }}
        />
      )}
    </span>
  );
};

/* -------------------------------------------------------------------------- */
/* A faixa-resumo                                                              */

const Summary = ({ data }: { readonly data: Overview }): React.ReactElement => {
  const { totals } = data;
  const badge = overviewBadge(totals);
  const counted = data.portfolios.flatMap((row) =>
    row.goal !== null && row.goal.counted ? [row.portfolio_name] : [],
  );
  const arrival = againstDeadline(totals.pace_months_vs_deadline);
  const steps = totals.required_schedule;
  const gap = Number(totals.gap_monthly);

  return (
    <section
      aria-label="Todos os objetivos"
      className="overflow-hidden rounded-panel border border-line bg-panel shadow-panel"
    >
      <header className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
        <div className="flex min-w-0 items-center gap-3">
          <h2 className="truncate text-[1.125rem] font-semibold">Todos os objetivos</h2>
          {badge === null ? null : <Badge tone={badge.tone}>{badge.text}</Badge>}
        </div>
      </header>

      <p className="flex flex-wrap gap-x-5 gap-y-1 border-y border-line bg-panel-2 px-5 py-2.5 text-[0.8125rem]">
        <Fact label="Meta">
          <span title="Soma das metas em reais de hoje: as que são em reais da data alvo entram convertidas pelo IPCA 12M.">
            <Money value={totals.target_amount} decimals={0} />
          </span>
        </Fact>
        <Fact label="Prazo">{monthYearLabel(totals.last_target_date)}</Fact>
        <Fact label="Rentabilidade">
          <span className="font-sans">
            {data.portfolios
              .flatMap((row) =>
                row.goal !== null && row.goal.counted && row.goal.rate !== null
                  ? [
                      `${row.portfolio_name} ${percentText(row.goal.rate.used_pct)} ao ano`,
                    ]
                  : [],
              )
              .join(' · ')}
          </span>
        </Fact>
        <Fact label="Carteiras">
          <span className="font-sans">{counted.join(' e ')}</span>
        </Fact>
      </p>

      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <Stat
          label="Acumulado"
          value={<Money value={totals.current_value} />}
          sub={
            <>
              <Percent value={percentAsRatio(totals.progress_pct)} decimals={1} /> da meta
              somada
            </>
          }
        />
        <Stat
          label="Falta"
          value={<Money value={totals.remaining_brl} />}
          sub="em reais de hoje"
        />
        <Stat
          label="Aporte necessário"
          value={<Money value={totals.required_monthly} decimals={0} />}
          sub={
            steps.length < 2 ? (
              `por mês até ${monthYearLabel(totals.last_target_date)}`
            ) : (
              <>
                por mês até {monthYearLabel(steps[0]?.until ?? null)}, depois{' '}
                <Money value={steps[1]?.monthly ?? '0'} decimals={0} />
              </>
            )
          }
        />
        <Stat
          label="Você aporta hoje"
          value={<Money value={totals.current_monthly} decimals={0} />}
          sub={
            gap > 0 ? (
              <>
                faltam <Money value={totals.gap_monthly} decimals={0} /> por mês
              </>
            ) : (
              'já cobre o necessário'
            )
          }
          subTone={gap > 0 ? 'attention' : 'positive'}
        />
        <Stat
          label="No ritmo atual"
          value={
            totals.pace_arrival_date === null
              ? 'não chega'
              : monthYearLabel(totals.pace_arrival_date)
          }
          sub={
            totals.pace_months_vs_deadline === null
              ? 'alguma meta não fecha em 100 anos'
              : arrival.tone === 'positive'
                ? arrival.text
                : `${arrival.text.replace('+', '')} depois do prazo`
          }
          subTone={arrival.tone === 'positive' ? 'positive' : 'attention'}
        />
      </div>

      <div className="flex flex-col gap-2 border-t border-line px-5 py-4">
        <Track
          progress={totals.progress_pct}
          expected={totals.expected_pct}
          state="on_track"
          label={`${totals.progress_pct}% da meta somada`}
        />
        <span className="relative flex justify-between text-[0.8125rem]">
          <span className="tabular">
            <strong className="font-semibold">
              <Percent value={percentAsRatio(totals.progress_pct)} decimals={1} />
            </strong>{' '}
            <span className="text-ink-2">acumulado</span>
          </span>
          {totals.expected_pct === null ? null : (
            <span className="tabular text-ink-3">
              esperado hoje{' '}
              <Percent value={percentAsRatio(totals.expected_pct)} decimals={1} />
            </span>
          )}
          <span className="tabular text-ink-3">
            <Money value={totals.target_amount} decimals={0} />
          </span>
        </span>
      </div>
    </section>
  );
};

/* -------------------------------------------------------------------------- */
/* O simulador                                                                 */

const Simulator = ({
  data,
  cascade,
  onChange,
}: {
  readonly data: Overview;
  readonly cascade: boolean;
  readonly onChange: (change: GoalsOverviewChange) => void;
}): React.ReactElement => {
  return (
    <Panel
      title="Se eu aportar por mês"
      action={<span className="text-xs text-ink-3">quando a última meta fecha</span>}
    >
      <ul
        aria-label="Aporte mensal total e data da última meta"
        className="flex flex-col"
      >
        {data.scenarios.map((scenario) => {
          const lateness = againstDeadline(scenario.months_vs_deadline);

          return (
            <li key={`${scenario.kind}:${scenario.monthly}`}>
              <button
                type="button"
                aria-pressed={scenario.selected}
                title={
                  scenario.kind === 'current'
                    ? 'Simular mantendo o aporte atual de cada carteira'
                    : 'Simular com este aporte'
                }
                onClick={() => onChange({ budget: scenario.monthly })}
                className={`${scenarioRow(scenario.selected)} cursor-pointer hover:bg-panel-2`}
              >
                <ScenarioCells
                  monthly={scenario.monthly}
                  note={SCENARIO_LABEL[scenario.kind]}
                  arrival={
                    scenario.arrival_date === null
                      ? 'não chega'
                      : monthYearLabel(scenario.arrival_date)
                  }
                  lateness={lateness}
                />
              </button>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-col gap-3 border-t border-line px-5 py-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <BudgetForm
            placeholder={Number(data.plan.budget).toLocaleString('pt-BR')}
            resetLabel="Voltar ao necessário"
            onSimulate={(monthly) => onChange({ budget: monthly })}
            onReset={() => onChange({ budget: null })}
          />

          <span aria-hidden="true" className="hidden h-6 w-px bg-line xl:block" />

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <label className="flex cursor-pointer items-center gap-2 text-[0.8125rem] text-ink-2">
              <input
                type="checkbox"
                checked={cascade}
                onChange={(event) => onChange({ cascade: event.target.checked })}
                className="size-4 cursor-pointer accent-accent"
              />
              Reaproveitar o aporte de metas concluídas
            </label>
          </div>
        </div>

        <p className="text-[0.75rem] text-ink-3">
          O aporte sugerido é um plano de destino dos aportes futuros. O dinheiro já
          investido não migra entre carteiras.
        </p>
      </div>
    </Panel>
  );
};

/* -------------------------------------------------------------------------- */
/* Os gráficos                                                                 */

const Trajectory = ({ data }: { readonly data: Overview }): React.ReactElement | null => {
  const { chart, totals, plan } = data;
  if (chart === null) return null;

  const dates = chart.dates as DateOnly[];
  const ticks = monthTicks(dates);
  const showPlan = plan.budget !== totals.required_monthly;

  return (
    <Panel
      title="Trajetória"
      action={
        <span className="text-xs text-ink-3">
          soma dos patrimônios dos objetivos em reais de hoje
        </span>
      }
    >
      <div className="px-5 pt-4 pb-3.5">
        <SeriesChart
          dates={dates}
          series={overviewSeries(chart, showPlan)}
          valueFormat="money"
          fromZero
          endDot
          endLabels
          compactEndLabels
          endLabelSeries={['pace']}
          ariaLabel="Trajetória da soma dos objetivos"
          xTickLabel={(date) => ticks.get(date) ?? ''}
          tooltipDateLabel={(date) => monthYearLabel(date)}
          reference={{
            value: chart.target_amount,
            label: `Meta R$ ${formatCompact(chart.target_amount).body}`,
            color: 'var(--color-ink-3)',
            hideLegend: true,
          }}
          legendValues={{
            pace: (
              <>
                <Money value={totals.current_monthly} decimals={0} />
                /mês
              </>
            ),
            required: (
              <>
                <Money value={totals.required_monthly} decimals={0} />
                /mês
              </>
            ),
            plan: (
              <>
                <Money value={plan.budget} decimals={0} />
                /mês
              </>
            ),
          }}
          height={260}
        />
      </div>
    </Panel>
  );
};

/* -------------------------------------------------------------------------- */
/* A tabela                                                                    */

const Sub = ({
  children,
}: {
  readonly children: React.ReactNode;
}): React.ReactElement => (
  <span className="block text-[0.71875rem] text-ink-3">{children}</span>
);

const TH = 'px-4 py-3 font-medium';
const TD = 'px-4 py-4 align-middle';

const PortfolioTable = ({
  data,
  onOpenPortfolio,
}: {
  readonly data: Overview;
  readonly onOpenPortfolio: (portfolioId: string) => void;
}): React.ReactElement => {
  const rows = sortRows(data.portfolios);
  const { totals } = data;
  // Sem simulação o plano é o próprio aporte necessário: a coluna repetiria a anterior.
  const showPlan = data.plan.budget !== totals.required_monthly;

  return (
    <Panel
      title="Por carteira"
      action={<span className="text-xs text-ink-3">mais atrasadas primeiro</span>}
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-264 border-collapse text-[0.8125rem]">
          <caption className="sr-only">
            O objetivo de cada carteira, o aporte necessário e quando ele chega
          </caption>
          <thead>
            <tr className="tabular text-label font-medium tracking-[0.06em] text-ink-3 uppercase">
              <th scope="col" className={`${TH} text-left`}>
                Carteira
              </th>
              <th scope="col" className={`${TH} text-left`}>
                Objetivo
              </th>
              <th scope="col" className={`${TH} text-left`}>
                Progresso
              </th>
              <th scope="col" className={`${TH} text-right`}>
                Falta
              </th>
              <th scope="col" className={`${TH} text-right`}>
                Aporte necessário
              </th>
              <th scope="col" className={`${TH} text-right`}>
                Aporte hoje
              </th>
              {showPlan ? (
                <th scope="col" className={`${TH} text-right`}>
                  No plano
                </th>
              ) : null}
              <th scope="col" className={`${TH} text-right`}>
                Chega em
              </th>
              <th scope="col" className={`${TH} text-left`}>
                Situação
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const goal = row.goal;

              if (goal === null) {
                return (
                  <tr key={row.portfolio_id} className="border-t border-line text-ink-3">
                    <th scope="row" className="px-4 py-4 text-left font-normal">
                      <PortfolioLink row={row} onOpen={onOpenPortfolio} />
                    </th>
                    <td colSpan={showPlan ? 7 : 6} className={TD}>
                      Sem objetivo
                    </td>
                    <td className={TD}>
                      <Button onClick={() => onOpenPortfolio(row.portfolio_id)}>
                        Definir objetivo
                      </Button>
                    </td>
                  </tr>
                );
              }

              const late = latenessOf(
                goal.current_months_to_arrival,
                goal.months_remaining,
              );
              const state = barState(goal.status);

              return (
                <tr
                  key={row.portfolio_id}
                  className={`border-t border-line ${goal.counted ? '' : 'text-ink-3'}`}
                >
                  <th scope="row" className="px-4 py-4 text-left font-normal">
                    <PortfolioLink row={row} onOpen={onOpenPortfolio} />
                  </th>
                  <td className={`${TD} min-w-64`}>
                    {goal.name}
                    <Sub>
                      <Money value={goal.target_amount} decimals={0} /> ·{' '}
                      {monthYearLabel(goal.target_date)}
                    </Sub>
                    {goal.nominal_target_amount === null ? null : (
                      <Sub>
                        meta de <Money value={goal.nominal_target_amount} decimals={0} />{' '}
                        em {monthYearLabel(goal.target_date)}, em reais de hoje
                      </Sub>
                    )}
                  </td>
                  <td className={TD}>
                    <span className="flex items-center gap-2">
                      <span className="w-24">
                        <Track
                          progress={goal.progress_pct}
                          expected={goal.expected_pct}
                          state={state}
                          label={STATUS_LABEL[goal.status]}
                        />
                      </span>
                      <span className="tabular">
                        <Percent value={percentAsRatio(goal.progress_pct)} decimals={1} />
                      </span>
                    </span>
                  </td>
                  <td className={`${TD} text-right`}>
                    <Money value={goal.remaining_brl} />
                  </td>
                  {goal.counted ? (
                    <>
                      <td className={`${TD} text-right`}>
                        <strong className="font-semibold">
                          <Money value={goal.required_monthly} decimals={0} />
                        </strong>
                        <Sub>
                          <Percent
                            value={percentAsRatio(goal.required_share_pct)}
                            decimals={0}
                          />{' '}
                          do total
                        </Sub>
                      </td>
                      <td className={`${TD} text-right`}>
                        <Money value={goal.current_monthly} decimals={0} />
                        <Sub>
                          <Percent
                            value={percentAsRatio(goal.current_share_pct)}
                            decimals={0}
                          />{' '}
                          do total
                        </Sub>
                      </td>
                      {showPlan ? (
                        <td className={`${TD} text-right`}>
                          {goal.plan === null ? null : (
                            <>
                              <Money value={goal.plan.monthly} decimals={0} />
                              <Sub>
                                {goal.plan.arrival_date === null
                                  ? 'não chega'
                                  : monthYearLabel(goal.plan.arrival_date)}
                              </Sub>
                            </>
                          )}
                        </td>
                      ) : null}
                      <td className={`${TD} text-right`}>
                        <span className="tabular whitespace-nowrap">
                          {goal.current_arrival_date === null
                            ? 'não chega'
                            : goal.current_months_to_arrival === 0
                              ? 'já chegou'
                              : monthYearLabel(goal.current_arrival_date)}
                        </span>
                        {late === null ? null : (
                          <span
                            className={`block text-[0.71875rem] ${
                              late.tone === 'positive'
                                ? 'text-positive'
                                : 'text-attention'
                            }`}
                          >
                            {late.text}
                          </span>
                        )}
                      </td>
                    </>
                  ) : (
                    <td colSpan={showPlan ? 4 : 3} className={`${TD} text-right text-xs`}>
                      {goal.excluded_reason === null
                        ? null
                        : EXCLUSION_LABEL[goal.excluded_reason]}
                    </td>
                  )}
                  <td className={TD}>
                    <span className="flex items-center gap-1.5 whitespace-nowrap">
                      <span
                        aria-hidden="true"
                        className={`size-2 rounded-full ${
                          goal.status === 'on_track' || goal.status === 'reached'
                            ? 'bg-positive'
                            : goal.status === 'no_projection'
                              ? 'bg-ink-3'
                              : 'bg-attention'
                        }`}
                      />
                      {STATUS_LABEL[goal.status]}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-line bg-panel-2 font-semibold">
              <th scope="row" colSpan={3} className="px-4 py-4 text-left font-semibold">
                Total
              </th>
              <td className={`${TD} text-right`}>
                <Money value={totals.remaining_brl} />
              </td>
              <td className={`${TD} text-right`}>
                <Money value={totals.required_monthly} decimals={0} />
                <Sub>100%</Sub>
              </td>
              <td className={`${TD} text-right`}>
                <Money value={totals.current_monthly} decimals={0} />
                <Sub>100%</Sub>
              </td>
              {showPlan ? (
                <td className={`${TD} text-right`}>
                  <Money value={data.plan.budget} decimals={0} />
                  <Sub>
                    {data.plan.arrival_date === null
                      ? 'não chega'
                      : monthYearLabel(data.plan.arrival_date)}
                  </Sub>
                </td>
              ) : null}
              <td colSpan={2} className="px-4" />
            </tr>
          </tfoot>
        </table>
      </div>
    </Panel>
  );
};

const PortfolioLink = ({
  row,
  onOpen,
}: {
  readonly row: OverviewRow;
  readonly onOpen: (portfolioId: string) => void;
}): React.ReactElement => (
  <button
    type="button"
    title="Abrir os objetivos desta carteira"
    className="flex cursor-pointer items-center gap-1 hover:text-accent"
    onClick={() => onOpen(row.portfolio_id)}
  >
    {row.portfolio_name}
    <Icon name="chevron-right" size={12} />
  </button>
);

/* -------------------------------------------------------------------------- */

const Empty = (): React.ReactElement => (
  <section className="rounded-panel border border-line bg-panel p-8 text-center">
    <h2 className="text-panel-title font-semibold">Nenhum objetivo nas carteiras</h2>
    <p className="mx-auto mt-2 max-w-prose text-[0.8125rem] text-ink-2">
      Cada carteira tem um objetivo de valor e prazo. Escolha uma carteira na barra
      lateral e defina o dela: aqui você vê quanto aportar no total para bater todos.
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
    <p className="mx-auto mt-2 max-w-prose text-[0.8125rem] text-ink-2">
      {error.message}
    </p>
    <button
      type="button"
      className="mt-4 h-control cursor-pointer rounded-control border border-line px-3 text-[0.8125rem] hover:bg-panel-2"
      onClick={onRetry}
    >
      Tentar novamente
    </button>
  </section>
);

export const GoalsOverviewView = ({
  resource,
  cascade,
  rates,
  onRateChange,
  onChange,
  onOpenPortfolio,
}: GoalsOverviewViewProps): React.ReactElement => {
  const { state, pending, reload } = resource;
  const { hidden, toggleHidden } = usePreferences();

  if (state.kind === 'loading') {
    return (
      <SkeletonRegion label="Carregando os objetivos" className="flex flex-col gap-4">
        <SkeletonHeader />
        <SkeletonPanel title="Todos os objetivos">
          <SkeletonTable rows={2} columns={5} />
        </SkeletonPanel>
        <SkeletonPanel>
          <SkeletonChart />
        </SkeletonPanel>
      </SkeletonRegion>
    );
  }
  if (state.kind === 'error') return <Failed error={state.error} onRetry={reload} />;

  const data = state.value;
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-screen-title leading-7 font-semibold">Objetivos</h1>
          <p className="truncate text-xs text-ink-3">
            Todas as carteiras · um objetivo por carteira
          </p>
        </div>
        <IconButton
          label={hidden ? 'Mostrar valores' : 'Ocultar valores'}
          aria-pressed={hidden}
          icon={hidden ? 'eye-off' : 'eye'}
          onClick={toggleHidden}
        />
      </header>

      {data.totals.goals === 0 ? (
        <Empty />
      ) : (
        <KeepPrevious pending={pending} className="flex flex-col gap-4">
          {data.totals.counted > 0 ? (
            <>
              <Summary data={data} />
              <Trajectory data={data} />
              <Simulator data={data} cascade={cascade} onChange={onChange} />
              <RatesPanel
                rows={data.portfolios.flatMap((row) =>
                  row.goal === null || row.goal.rate === null
                    ? []
                    : [
                        {
                          id: row.portfolio_id,
                          name: row.portfolio_name,
                          current_value: row.goal.current_value,
                          premise_pct: row.goal.rate.premise_pct,
                        },
                      ],
                )}
                rates={rates}
                onChange={onRateChange}
              />
            </>
          ) : (
            <p
              role="status"
              className="rounded-control bg-attention-soft p-3 text-[0.8125rem] text-attention"
            >
              Nenhum objetivo entra na soma: metas em reais da data alvo, vencidas ou sem
              projeção ficam fora. Veja o motivo de cada uma abaixo.
            </p>
          )}
          <PortfolioTable data={data} onOpenPortfolio={onOpenPortfolio} />
        </KeepPrevious>
      )}
    </div>
  );
};
