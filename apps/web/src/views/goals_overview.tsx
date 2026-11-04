import type { GoalsOverviewResource } from '@patrimonio/contracts';
import type { DateOnly } from '@patrimonio/domain';
import { useCallback, useState } from 'react';
import { useSearchParams } from 'react-router';

import { fetchGoalsOverview } from '../api/goals.js';
import { Icon } from '../components/icon.js';
import { Money, Percent } from '../components/number.js';
import { KeepPrevious } from '../components/pending.js';
import { usePreferences } from '../components/preferences.js';
import { Button, IconButton, Panel, Segmented } from '../components/primitives.js';
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
  DISTRIBUTION_OPTIONS,
  EXCLUSION_LABEL,
  SCENARIO_LABEL,
  againstDeadline,
  decodeBudget,
  decodeCascade,
  decodeDistribution,
  decodePriority,
  effectivePriority,
  moveInOrder,
  overviewBadge,
  overviewSeries,
  parseBudgetInput,
  sortRows,
} from '../lib/goals_overview.js';
import type { Distribution } from '../lib/goals_overview.js';
import { monthTicks, percentAsRatio } from '../lib/overview.js';
import type { Resource } from '../lib/use_resource.js';
import { useResource } from '../lib/use_resource.js';
import { Fact, Stat } from './goals.js';

/**
 * T-07 · Objetivos em "Todas as carteiras" — a prancha `18C`.
 *
 * Um panorama: cada carteira tem o seu objetivo, e a pergunta é "quanto preciso
 * aportar por mês, no total e em cada carteira, para bater todas as metas, e
 * quando isso acontece". Criar, editar e excluir continuam dentro da carteira;
 * clicar numa linha leva até lá.
 *
 * Nada aqui faz conta: somas, fatias, datas e o plano de aportes chegam
 * prontos da `api`. O orçamento, a distribuição, a cascata e a fila de
 * prioridade vivem na URL — são da sessão, nunca gravados.
 */
type Overview = GoalsOverviewResource;
type OverviewRow = Overview['portfolios'][number];

export type GoalsOverviewChange = {
  readonly budget?: string | null;
  readonly distribution?: Distribution;
  readonly cascade?: boolean;
  readonly priority?: readonly string[] | null;
};

export type GoalsOverviewViewProps = {
  readonly resource: Resource<Overview>;
  readonly budget: string | null;
  readonly distribution: Distribution;
  readonly cascade: boolean;
  readonly priority: readonly string[];
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
  const distribution = decodeDistribution(params.get('distribuicao'));
  const cascade = decodeCascade(params.get('cascata'));
  const priority = decodePriority(params.get('prioridade'));

  const onChange = useCallback(
    (change: GoalsOverviewChange) =>
      setParams(
        (current) => {
          const search = new URLSearchParams(current);

          if (change.budget !== undefined) {
            if (change.budget === null) search.delete('aporte');
            else search.set('aporte', change.budget);
          }
          if (change.distribution !== undefined) {
            if (change.distribution === 'proportional') search.delete('distribuicao');
            else search.set('distribuicao', change.distribution);
          }
          if (change.cascade !== undefined) {
            if (change.cascade) search.delete('cascata');
            else search.set('cascata', '0');
          }
          if (change.priority !== undefined) {
            if (change.priority === null || change.priority.length === 0) {
              search.delete('prioridade');
            } else {
              search.set('prioridade', change.priority.join(','));
            }
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
          distribution,
          cascade,
          priority: distribution === 'priority' ? priority : [],
        },
        signal,
      ),
    [budget, distribution, cascade, priority.join(',')],
  );

  return (
    <GoalsOverviewView
      resource={resource}
      budget={budget}
      distribution={distribution}
      cascade={cascade}
      priority={priority}
      onChange={onChange}
      onOpenPortfolio={onOpenPortfolio}
    />
  );
};

/* -------------------------------------------------------------------------- */

const TONE_TEXT = {
  positive: 'text-positive',
  attention: 'text-attention',
  negative: 'text-negative',
} as const;

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
  const converted = data.portfolios.filter(
    (row) => row.goal?.counted === true && row.goal.nominal_target_amount !== null,
  ).length;
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
        <Fact label="Meta somada">
          <Money value={totals.target_amount} decimals={0} />
        </Fact>
        <span className="-ml-3.5 text-ink-2">
          em reais de hoje
          {converted > 0 && totals.inflation_pct !== null
            ? ` · ${converted === 1 ? 'uma meta' : `${converted} metas`} em reais da data alvo convertida${converted === 1 ? '' : 's'} pelo IPCA 12M (${totals.inflation_pct.replace('.', ',')}%)`
            : ''}
        </span>
        <Fact label="Último prazo">{monthYearLabel(totals.last_target_date)}</Fact>
        <Fact label="Objetivos">
          {totals.counted} <span className="font-sans text-ink-2">, um por carteira</span>
        </Fact>
        <Fact label="Contas">
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
  distribution,
  cascade,
  onChange,
}: {
  readonly data: Overview;
  readonly distribution: Distribution;
  readonly cascade: boolean;
  readonly onChange: (change: GoalsOverviewChange) => void;
}): React.ReactElement => {
  const [draft, setDraft] = useState('');
  const parsed = parseBudgetInput(draft);
  const invalid = draft.trim() !== '' && parsed === null;

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
          const note = SCENARIO_LABEL[scenario.kind];

          return (
            <li key={`${scenario.kind}:${scenario.monthly}`}>
              <button
                type="button"
                aria-pressed={scenario.selected}
                disabled={scenario.kind === 'current'}
                title={
                  scenario.kind === 'current'
                    ? 'O ritmo atual de cada carteira, sem mudar nada'
                    : 'Simular com este aporte'
                }
                onClick={() => onChange({ budget: scenario.monthly })}
                className={`flex w-full items-center justify-between gap-3 border-b border-line px-5 py-3 text-left last:border-b-0 enabled:cursor-pointer enabled:hover:bg-panel-2 ${
                  scenario.selected ? 'bg-accent-soft' : ''
                }`}
              >
                <span className="flex items-baseline gap-2">
                  <span className="tabular text-base font-semibold">
                    <Money value={scenario.monthly} decimals={0} />
                  </span>
                  <span className="text-xs text-ink-3">/ mês</span>
                  {note === '' ? null : (
                    <span className="ml-1 rounded-[4px] bg-panel-2 px-2 py-0.5 text-[0.71875rem] font-medium text-ink-2">
                      {note}
                    </span>
                  )}
                </span>
                <span className="flex flex-col items-end">
                  <span className="tabular text-base font-semibold">
                    {scenario.arrival_date === null
                      ? 'não chega'
                      : monthYearLabel(scenario.arrival_date)}
                  </span>
                  <span className={`text-xs ${TONE_TEXT[lateness.tone]}`}>
                    {lateness.text}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-col gap-3 border-t border-line px-5 py-4">
        <form
          className="flex flex-wrap items-center gap-2 text-[0.8125rem]"
          onSubmit={(event) => {
            event.preventDefault();
            if (parsed !== null) onChange({ budget: parsed });
          }}
        >
          <label className="flex items-center gap-2 text-ink-2">
            Quanto posso aportar por mês
            <span className="tabular flex h-control items-center gap-1 rounded-control border border-line bg-panel px-2">
              R$
              <input
                inputMode="decimal"
                aria-invalid={invalid}
                value={draft}
                placeholder={Number(data.plan.budget).toLocaleString('pt-BR')}
                onChange={(event) => setDraft(event.target.value)}
                className="w-24 bg-transparent text-right outline-none"
              />
            </span>
          </label>
          <Button type="submit" disabled={parsed === null}>
            Simular
          </Button>
          {draft === '' ? null : (
            <Button
              onClick={() => {
                setDraft('');
                onChange({ budget: null });
              }}
            >
              Voltar ao necessário
            </Button>
          )}
          {invalid ? (
            <span role="alert" className="text-negative">
              Informe um valor maior que zero.
            </span>
          ) : null}
        </form>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Segmented
            label="Como dividir o aporte"
            options={DISTRIBUTION_OPTIONS}
            value={distribution}
            onChange={(next) => onChange({ distribution: next })}
          />
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

const countedRows = (rows: readonly OverviewRow[]): readonly OverviewRow[] =>
  rows.filter((row) => row.goal !== null && row.goal.counted);

const Split = ({
  rows,
}: {
  readonly rows: readonly OverviewRow[];
}): React.ReactElement => (
  <Panel
    title="Para onde vai o aporte"
    action={<span className="text-xs text-ink-3">necessário × o que aporto hoje</span>}
  >
    <ul className="flex flex-col gap-3 px-5 py-4">
      {countedRows(rows).map((row) => {
        const goal = row.goal;
        if (goal === null) return null;
        const needed = Number(goal.required_share_pct ?? 0);
        const current = Number(goal.current_share_pct ?? 0);

        return (
          <li key={row.portfolio_id} className="flex flex-col gap-1">
            <span className="text-[0.8125rem] font-medium">{row.portfolio_name}</span>
            {(
              [
                ['necessário', needed, goal.required_share_pct, 'bg-accent'],
                ['hoje', current, goal.current_share_pct, 'bg-ink-3'],
              ] as const
            ).map(([label, width, pct, color]) => (
              <span key={label} className="flex items-center gap-2 text-xs">
                <span className="w-16 text-ink-3">{label}</span>
                <span
                  role="img"
                  aria-label={`${label}: ${pct ?? '0'}%`}
                  className="relative block h-2 flex-1 rounded-[4px] bg-panel-2"
                >
                  <span
                    aria-hidden="true"
                    className={`absolute inset-y-0 left-0 rounded-[4px] ${color}`}
                    style={{ width: `${Math.min(100, Math.max(0, width))}%` }}
                  />
                </span>
                <span className="tabular w-12 text-right">
                  <Percent value={percentAsRatio(pct)} decimals={0} />
                </span>
              </span>
            ))}
          </li>
        );
      })}
    </ul>
  </Panel>
);

const Timeline = ({ data }: { readonly data: Overview }): React.ReactElement | null => {
  const horizon = Math.max((data.chart?.dates.length ?? 1) - 1, 1);
  const rows = countedRows(data.portfolios);
  if (rows.length === 0) return null;

  const place = (months: number): number => Math.min(100, (months / horizon) * 100);

  return (
    <Panel
      title="Prazo e chegada"
      action={<span className="text-xs text-ink-3">no ritmo atual de cada carteira</span>}
    >
      <ul className="flex flex-col gap-3 px-5 py-4">
        {rows.map((row) => {
          const goal = row.goal;
          if (goal === null) return null;

          const deadline = place(goal.months_remaining);
          const arrival =
            goal.current_months_to_arrival === null
              ? null
              : place(goal.current_months_to_arrival);
          const late = latenessOf(goal.current_months_to_arrival, goal.months_remaining);
          const from = Math.min(deadline, arrival ?? 100);
          const to = Math.max(deadline, arrival ?? 100);

          return (
            <li key={row.portfolio_id} className="flex flex-col gap-1">
              <span className="flex items-baseline justify-between text-[0.8125rem]">
                <span className="font-medium">{row.portfolio_name}</span>
                <span className="tabular text-xs text-ink-3">
                  prazo {monthYearLabel(goal.target_date)} ·{' '}
                  {goal.current_arrival_date === null
                    ? 'não chega'
                    : `chega ${monthYearLabel(goal.current_arrival_date)}`}
                </span>
              </span>
              <span
                role="img"
                aria-label={`${row.portfolio_name}: prazo ${monthYearLabel(
                  goal.target_date,
                )}, ${late === null ? 'não chega em 100 anos' : late.text}`}
                className="relative block h-4"
              >
                <span
                  aria-hidden="true"
                  className="absolute top-1/2 right-0 left-0 h-px bg-line"
                />
                <span
                  aria-hidden="true"
                  className={`absolute top-1/2 h-1 -translate-y-1/2 rounded-[2px] ${
                    late === null
                      ? 'bg-negative'
                      : late.tone === 'positive'
                        ? 'bg-positive'
                        : 'bg-attention'
                  }`}
                  style={{ left: `${from}%`, width: `${to - from}%` }}
                />
                <span
                  aria-hidden="true"
                  title="prazo"
                  className="absolute top-0 h-4 w-0.5 bg-ink"
                  style={{ left: `${deadline}%` }}
                />
                {arrival === null ? null : (
                  <span
                    aria-hidden="true"
                    title="chegada no ritmo atual"
                    className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent"
                    style={{ left: `${arrival}%` }}
                  />
                )}
              </span>
            </li>
          );
        })}
      </ul>
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

const TH = 'px-4 py-[9px] font-medium';

const PortfolioTable = ({
  data,
  distribution,
  order,
  priority,
  onChange,
  onOpenPortfolio,
}: {
  readonly data: Overview;
  readonly distribution: Distribution;
  readonly order: readonly string[];
  readonly priority: readonly string[];
  readonly onChange: (change: GoalsOverviewChange) => void;
  readonly onOpenPortfolio: (portfolioId: string) => void;
}): React.ReactElement => {
  const rows = sortRows(data.portfolios, distribution, priority);
  const { totals } = data;

  return (
    <Panel
      title="Por carteira"
      action={
        <span className="text-xs text-ink-3">
          {distribution === 'priority'
            ? 'na ordem de prioridade do aporte'
            : 'mais atrasadas primeiro'}
        </span>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-240 border-collapse text-[0.8125rem]">
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
              <th scope="col" className={`${TH} text-right`}>
                No plano
              </th>
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
                  <tr
                    key={row.portfolio_id}
                    className="h-(--row-height) border-t border-line text-ink-3"
                  >
                    <th scope="row" className="px-4 text-left font-normal">
                      <PortfolioLink row={row} onOpen={onOpenPortfolio} />
                    </th>
                    <td colSpan={7} className="px-4">
                      Sem objetivo
                    </td>
                    <td className="px-4">
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
              const position = order.indexOf(row.portfolio_id);

              return (
                <tr
                  key={row.portfolio_id}
                  className={`h-(--row-height) border-t border-line ${
                    goal.counted ? '' : 'text-ink-3'
                  }`}
                >
                  <th scope="row" className="px-4 text-left font-normal">
                    <span className="flex items-center gap-1">
                      {distribution === 'priority' && goal.counted ? (
                        <span className="-ml-2 flex">
                          <IconButton
                            row
                            label={`Subir a prioridade de ${row.portfolio_name}`}
                            icon="arrow-up"
                            disabled={position <= 0}
                            onClick={() =>
                              onChange({
                                priority: moveInOrder(order, row.portfolio_id, -1),
                              })
                            }
                          />
                          <IconButton
                            row
                            label={`Descer a prioridade de ${row.portfolio_name}`}
                            icon="arrow-down"
                            disabled={position === order.length - 1}
                            onClick={() =>
                              onChange({
                                priority: moveInOrder(order, row.portfolio_id, 1),
                              })
                            }
                          />
                        </span>
                      ) : null}
                      <PortfolioLink row={row} onOpen={onOpenPortfolio} />
                    </span>
                  </th>
                  <td className="px-4">
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
                  <td className="px-4">
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
                  <td className="px-4 text-right">
                    <Money value={goal.remaining_brl} />
                  </td>
                  {goal.counted ? (
                    <>
                      <td className="px-4 text-right">
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
                      <td className="px-4 text-right">
                        <Money value={goal.current_monthly} decimals={0} />
                        <Sub>
                          <Percent
                            value={percentAsRatio(goal.current_share_pct)}
                            decimals={0}
                          />{' '}
                          do total
                        </Sub>
                      </td>
                      <td className="px-4 text-right">
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
                      <td className="px-4 text-right">
                        <span className="tabular">
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
                    <td colSpan={4} className="px-4 text-right text-xs">
                      {goal.excluded_reason === null
                        ? null
                        : EXCLUSION_LABEL[goal.excluded_reason]}
                    </td>
                  )}
                  <td className="px-4">
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
            <tr className="h-(--row-height) border-t border-line bg-panel-2 font-semibold">
              <th scope="row" colSpan={3} className="px-4 text-left font-semibold">
                Total
              </th>
              <td className="px-4 text-right">
                <Money value={totals.remaining_brl} />
              </td>
              <td className="px-4 text-right">
                <Money value={totals.required_monthly} decimals={0} />
                <Sub>100%</Sub>
              </td>
              <td className="px-4 text-right">
                <Money value={totals.current_monthly} decimals={0} />
                <Sub>100%</Sub>
              </td>
              <td className="px-4 text-right">
                <Money value={data.plan.budget} decimals={0} />
                <Sub>
                  {data.plan.arrival_date === null
                    ? 'não chega'
                    : monthYearLabel(data.plan.arrival_date)}
                </Sub>
              </td>
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
      Tentar de novo
    </button>
  </section>
);

export const GoalsOverviewView = ({
  resource,
  distribution,
  cascade,
  priority,
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
  const order = effectivePriority(
    priority,
    sortRows(data.portfolios, 'proportional', []).flatMap((row) =>
      row.goal !== null && row.goal.counted ? [row.portfolio_id] : [],
    ),
  );

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
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_26.5rem]">
                <Trajectory data={data} />
                <Simulator
                  data={data}
                  distribution={distribution}
                  cascade={cascade}
                  onChange={onChange}
                />
              </div>
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
          <PortfolioTable
            data={data}
            distribution={distribution}
            order={order}
            priority={order}
            onChange={onChange}
            onOpenPortfolio={onOpenPortfolio}
          />
          {data.totals.counted > 0 ? (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Split rows={data.portfolios} />
              <Timeline data={data} />
            </div>
          ) : null}
        </KeepPrevious>
      )}
    </div>
  );
};
