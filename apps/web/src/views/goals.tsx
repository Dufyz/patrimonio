import type { GoalResource, GoalsResource } from '@patrimonio/contracts';
import type { DateOnly } from '@patrimonio/domain';
import { useCallback, useState } from 'react';
import { useSearchParams } from 'react-router';

import { fetchGoals } from '../api/goals.js';
import { Money, Percent } from '../components/number.js';
import { KeepPrevious } from '../components/pending.js';
import { usePreferences } from '../components/preferences.js';
import {
  SkeletonChart,
  SkeletonHeader,
  SkeletonPanel,
  SkeletonRegion,
  SkeletonTable,
} from '../components/skeleton.js';
import { Button, IconButton, Label, Panel } from '../components/primitives.js';
import { SeriesChart } from '../components/series_chart.js';
import {
  BLOCK_REASON,
  KIND_LABEL,
  STATUS_LABEL,
  arrivalText,
  barState,
  chartSeries,
  decodeRate,
  assumptionLabel,
  latenessOf,
  monthYearLabel,
  normalizeRateInput,
  paceLabel,
  rowTone,
} from '../lib/goals.js';
import { formatCompact } from '../lib/format.js';
import { monthTicks, percentAsRatio } from '../lib/overview.js';
import type { Resource } from '../lib/use_resource.js';
import { useResource } from '../lib/use_resource.js';
import { Icon } from '../components/icon.js';
import { deleteGoal } from '../api/goals.js';
import { GoalDialog } from './registers/goal_dialog.js';
import { DeleteDialog } from './registers/delete_dialog.js';

/**
 * T-07 · Objetivos — a prancha `10 · Objetivos`.
 *
 * Responde "o ritmo atual chega lá?" com o que a pergunta pede: onde o objetivo
 * está contra onde deveria estar, as duas trajetórias até a data e a tabela de
 * quanto aportar para chegar quando. A projeção declara a taxa que usou e deixa
 * trocá-la; a troca vive na URL (`taxa`) e nunca é gravada no objetivo.
 *
 * Nada aqui faz conta: a `api` entrega progresso, projeção e trajetórias.
 */

export type GoalsViewProps = {
  readonly resource: Resource<GoalsResource>;
  readonly portfolioId: string;
  readonly scopeLabel: string;
  readonly rate: string | null;
  readonly onRateChange: (rate: string | null) => void;
};

export type GoalsScreenProps = {
  readonly portfolioId: string;
  readonly scopeLabel: string;
};

export const GoalsScreen = ({
  portfolioId,
  scopeLabel,
}: GoalsScreenProps): React.ReactElement => {
  const [params, setParams] = useSearchParams();
  const rate = decodeRate(params.get('taxa'));

  const onRateChange = useCallback(
    (next: string | null) =>
      setParams(
        (current) => {
          const search = new URLSearchParams(current);
          if (next === null) search.delete('taxa');
          else search.set('taxa', next);
          return search;
        },
        { replace: true },
      ),
    [setParams],
  );

  const resource = useResource(
    (signal) => fetchGoals({ portfolioId, rate }, signal),
    [portfolioId, rate],
  );

  return (
    <GoalsView
      resource={resource}
      portfolioId={portfolioId}
      scopeLabel={scopeLabel}
      rate={rate}
      onRateChange={onRateChange}
    />
  );
};

/* -------------------------------------------------------------------------- */

const RateControl = ({
  goal,
  override,
  onChange,
}: {
  readonly goal: GoalResource;
  readonly override: string | undefined;
  readonly onChange: (rate: string | null) => void;
}): React.ReactElement => {
  const [draft, setDraft] = useState(override ?? '');
  const parsed = normalizeRateInput(draft);
  const invalid = draft.trim() !== '' && parsed === null;
  const real = goal.rate?.basis !== 'nominal';

  return (
    <form
      className="flex flex-wrap items-center gap-2 text-[0.8125rem]"
      onSubmit={(event) => {
        event.preventDefault();
        if (parsed !== null) onChange(parsed);
      }}
    >
      <label className="flex items-center gap-2 text-ink-2">
        Taxa ao ano
        <input
          inputMode="decimal"
          aria-invalid={invalid}
          value={draft}
          placeholder={goal.rate?.declared_pct ?? '6,00'}
          onChange={(event) => setDraft(event.target.value)}
          className="tabular h-control w-20 rounded-control border border-line bg-panel px-2 text-right"
        />
        %
      </label>
      <Button type="submit" disabled={parsed === null}>
        Simular
      </Button>
      {override === undefined ? null : (
        <Button
          onClick={() => {
            setDraft('');
            onChange(null);
          }}
        >
          Voltar à premissa
        </Button>
      )}
      {invalid ? (
        <span role="alert" className="text-negative">
          Informe um número entre 0 e 100.
        </span>
      ) : (
        <span className="text-ink-3">
          {real ? 'taxa real, em reais de hoje' : 'taxa nominal'}
        </span>
      )}
    </form>
  );
};

const RateLine = ({
  goal,
}: {
  readonly goal: GoalResource;
}): React.ReactElement | null => {
  const { rate } = goal;
  if (rate === null) return null;

  return (
    <p className="text-[0.75rem] text-ink-3">
      Projeção com {rate.used_pct}% ao ano ({rate.basis === 'real' ? 'real' : 'nominal'}
      {rate.inflation_pct === null ? '' : `, IPCA 12M ${rate.inflation_pct}%`})
      {rate.overridden ? (
        <span className="text-attention">
          {' '}
          · alterada: a premissa guardada é {rate.declared_pct ?? '—'}%
        </span>
      ) : null}
    </p>
  );
};

const PILL =
  'rounded-[4px] bg-panel-2 px-2 py-0.5 text-[0.71875rem] font-medium text-ink-2';

const ContributionTable = ({
  goal,
}: {
  readonly goal: GoalResource;
}): React.ReactElement => (
  <ul aria-label="Aporte mensal e data de chegada" className="flex flex-col">
    {goal.contributions.map((row) => {
      const arrival = arrivalText(row.months_to_arrival, row.arrival_date);
      const tone = rowTone(row);
      const lateness = latenessOf(row.months_to_arrival, goal.months_remaining);
      const note =
        row.kind === 'current'
          ? paceLabel(goal.pace.months_measured)
          : KIND_LABEL[row.kind];

      return (
        <li
          key={`${row.kind}:${row.monthly_contribution}`}
          className={`flex items-center justify-between gap-3 border-b border-line px-5 py-3 last:border-b-0 ${
            row.kind === 'required' ? 'bg-accent-soft' : ''
          }`}
        >
          <span className="flex items-baseline gap-2">
            <span className="tabular text-base font-semibold">
              <Money value={row.monthly_contribution} decimals={0} />
            </span>
            <span className="text-xs text-ink-3">/ mês</span>
            {note === '' ? null : <span className={`ml-1 ${PILL}`}>{note}</span>}
          </span>
          <span className="flex flex-col items-end">
            <span className="tabular text-base font-semibold">{arrival.text}</span>
            <span
              className={`text-xs ${
                tone === 'negative' || lateness === null
                  ? 'text-negative'
                  : lateness.tone === 'positive'
                    ? 'text-positive'
                    : 'text-attention'
              }`}
            >
              {lateness === null ? '' : lateness.text}
            </span>
          </span>
        </li>
      );
    })}
  </ul>
);

export const Fact = ({
  label,
  children,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
}): React.ReactElement => (
  <span className="whitespace-nowrap">
    <span className="text-ink-3">{label}</span>{' '}
    <strong className="tabular font-semibold">{children}</strong>
  </span>
);

export const Stat = ({
  label,
  value,
  sub,
  subTone,
}: {
  readonly label: string;
  readonly value: React.ReactNode;
  readonly sub: React.ReactNode;
  readonly subTone?: 'attention' | 'positive' | undefined;
}): React.ReactElement => (
  <div className="flex min-w-0 flex-col gap-1 px-5 py-4 not-first:border-l not-first:border-line">
    <Label>{label}</Label>
    <span className="tabular text-[1.375rem] leading-7 font-semibold whitespace-nowrap">
      {value}
    </span>
    <span
      className={`text-xs ${
        subTone === 'attention'
          ? 'text-attention'
          : subTone === 'positive'
            ? 'text-positive'
            : 'text-ink-3'
      }`}
    >
      {sub}
    </span>
  </div>
);

const GoalTrack = ({ goal }: { readonly goal: GoalResource }): React.ReactElement => {
  const state = barState(goal.status);
  const progress = Math.min(100, Math.max(0, Number(goal.progress_pct)));
  const expected =
    goal.expected_pct === null
      ? null
      : Math.min(100, Math.max(0, Number(goal.expected_pct)));

  return (
    <div className="flex flex-col gap-2 px-5 py-4">
      <span
        role="img"
        aria-label={STATUS_LABEL[goal.status]}
        className="relative block h-2 rounded-[4px] bg-panel-2 shadow-[inset_0_0_0_1px_var(--color-line)]"
      >
        <span
          aria-hidden="true"
          className={`absolute inset-y-0 left-0 rounded-[4px] ${
            state === 'behind'
              ? 'bg-accent'
              : state === 'reached'
                ? 'bg-positive'
                : 'bg-accent'
          }`}
          style={{ width: `${progress}%` }}
        />
        {expected === null ? null : (
          <span
            aria-hidden="true"
            title="onde deveria estar hoje"
            className="absolute -top-[3px] h-3.5 w-0.5 bg-ink"
            style={{ left: `${expected}%` }}
          />
        )}
      </span>
      <span className="relative flex justify-between text-[0.8125rem]">
        <span className="tabular">
          <strong className="font-semibold">
            <Percent value={percentAsRatio(goal.progress_pct)} decimals={1} />
          </strong>{' '}
          <span className="text-ink-2">acumulado</span>
        </span>
        {goal.expected_pct === null ? null : (
          <span className="tabular text-ink-3">
            esperado hoje{' '}
            <Percent value={percentAsRatio(goal.expected_pct)} decimals={1} />
          </span>
        )}
        <span className="tabular text-ink-3">
          <Money value={goal.target_amount} decimals={0} />
        </span>
      </span>
    </div>
  );
};

const GoalPanel = ({
  goal,
  scopeLabel,
  override,
  onRateChange,
  onEdit,
}: {
  readonly goal: GoalResource;
  readonly scopeLabel: string;
  readonly onEdit: () => void;
  readonly override: string | undefined;
  readonly onRateChange: (rate: string | null) => void;
}): React.ReactElement => {
  const series = chartSeries(goal).map((entry) =>
    entry.id === 'pace' ? { ...entry, area: true } : entry,
  );
  const dates = (goal.chart?.dates ?? []) as DateOnly[];
  const ticks = monthTicks(dates);
  const projection = goal.projection;
  const arrivalLateness =
    projection === null
      ? null
      : latenessOf(projection.months_to_arrival, goal.months_remaining);
  const assumption = assumptionLabel(goal.rate?.assumption ?? null);

  return (
    <div className="flex flex-col gap-4">
      <section
        aria-label={goal.name}
        className="overflow-hidden rounded-panel border border-line bg-panel shadow-panel"
      >
        <header className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
          <div className="flex min-w-0 items-center gap-3">
            <h2 className="truncate text-[1.125rem] font-semibold">{goal.name}</h2>
            <span
              className={`rounded-[4px] px-2 py-0.5 text-[0.71875rem] font-medium ${
                goal.status === 'reached' || goal.status === 'on_track'
                  ? 'bg-positive-soft text-positive'
                  : goal.status === 'no_projection'
                    ? 'bg-panel-2 text-ink-2'
                    : 'bg-attention-soft text-attention'
              }`}
            >
              {STATUS_LABEL[goal.status]}
            </span>
          </div>
          <Button icon="pencil" onClick={onEdit}>
            Editar
          </Button>
        </header>

        <p className="flex flex-wrap gap-x-5 gap-y-1 border-y border-line bg-panel-2 px-5 py-2.5 text-[0.8125rem]">
          <Fact label="Meta">
            <Money value={goal.target_amount} decimals={0} />
          </Fact>
          <span className="-ml-3.5 text-ink-2">
            {goal.amount_in_today_brl ? 'em reais de hoje' : 'em reais da data alvo'}
          </span>
          <Fact label="Prazo">{monthYearLabel(goal.target_date)}</Fact>
          <Fact label="Premissa">{assumption ?? 'sem premissa'}</Fact>
          <Fact label="Conta só">
            <span className="font-sans">{scopeLabel}</span>
          </Fact>
        </p>

        <div
          className={`grid ${projection === null ? 'grid-cols-2' : 'grid-cols-2 lg:grid-cols-4'}`}
        >
          <Stat
            label="Acumulado"
            value={<Money value={goal.current_value} />}
            sub={
              <>
                <Percent value={percentAsRatio(goal.progress_pct)} decimals={1} /> da meta
                {goal.as_of === null ? ' · sem consolidação' : ''}
              </>
            }
          />
          {goal.surplus_brl === null ? (
            <Stat
              label="Falta"
              value={<Money value={goal.remaining_brl} />}
              sub={
                goal.amount_in_today_brl ? 'em reais de hoje' : 'em reais da data alvo'
              }
            />
          ) : (
            <Stat
              label="Excedente"
              value={<Money value={goal.surplus_brl} />}
              sub="acima da meta"
              subTone="positive"
            />
          )}
          {projection === null ? null : (
            <>
              <Stat
                label="Aporte necessário"
                value={<Money value={projection.required_monthly} decimals={0} />}
                sub={`por mês até ${monthYearLabel(goal.target_date)}`}
              />
              <Stat
                label="No ritmo atual"
                value={
                  projection.arrival_date === null
                    ? 'não chega'
                    : monthYearLabel(projection.arrival_date)
                }
                sub={
                  arrivalLateness === null
                    ? 'em 100 anos'
                    : arrivalLateness.tone === 'positive'
                      ? arrivalLateness.text
                      : `${arrivalLateness.text.replace('+', '')} depois do prazo`
                }
                subTone={
                  arrivalLateness === null
                    ? 'attention'
                    : arrivalLateness.tone === 'positive'
                      ? 'positive'
                      : 'attention'
                }
              />
            </>
          )}
        </div>

        <div className="border-t border-line">
          <GoalTrack goal={goal} />
        </div>

        {goal.blocked !== null ? (
          <p
            role="status"
            className="m-5 mt-0 rounded-control bg-attention-soft p-3 text-[0.8125rem] text-attention"
          >
            {BLOCK_REASON[goal.blocked]}
          </p>
        ) : goal.status === 'reached' ? (
          <p role="status" className="px-5 pb-4 text-[0.8125rem] text-positive">
            Meta atingida: não há o que projetar.
          </p>
        ) : goal.status === 'overdue' ? (
          <p role="status" className="px-5 pb-4 text-[0.8125rem] text-negative">
            O prazo de {monthYearLabel(goal.target_date)} passou e a meta não foi
            atingida. Edite a data para voltar a projetar.
          </p>
        ) : null}
      </section>

      {goal.chart !== null && goal.projection !== null ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_26.5rem]">
          <Panel
            title="Trajetória"
            action={
              <span className="text-xs text-ink-3">
                {goal.amount_in_today_brl
                  ? 'patrimônio do objetivo em reais de hoje'
                  : 'patrimônio do objetivo em reais da data alvo'}
              </span>
            }
          >
            <div className="px-5 pt-4 pb-3.5">
              <SeriesChart
                dates={dates}
                series={series}
                valueFormat="money"
                fromZero
                endDot
                endLabels
                compactEndLabels
                endLabelSeries={['pace']}
                ariaLabel={`Trajetória de ${goal.name}`}
                xTickLabel={(date) => ticks.get(date) ?? ''}
                tooltipDateLabel={(date) => monthYearLabel(date)}
                reference={{
                  value: goal.target_amount,
                  label: `Meta R$ ${formatCompact(goal.target_amount).body}`,
                  color: 'var(--color-ink-3)',
                  hideLegend: true,
                }}
                legendValues={{
                  pace: (
                    <>
                      <Money value={goal.pace.monthly_contribution} decimals={0} />
                      /mês
                    </>
                  ),
                  required: (
                    <>
                      <Money value={goal.projection.required_monthly} decimals={0} />
                      /mês
                    </>
                  ),
                }}
                height={260}
              />
              <p className="mt-1 text-[0.75rem] text-ink-3">
                No ritmo atual chega a{' '}
                <Money value={goal.projection.projected_amount} decimals={0} /> em{' '}
                {monthYearLabel(goal.target_date)}
                {Number(goal.projection.gap_brl) > 0 ? (
                  <>
                    , <Money value={goal.projection.gap_brl} decimals={0} /> abaixo da
                    meta
                  </>
                ) : null}
                .
              </p>
            </div>
          </Panel>

          <Panel
            title="Se eu aportar por mês"
            action={
              <span className="text-xs text-ink-3">quando o objetivo é atingido</span>
            }
          >
            <ContributionTable goal={goal} />
            <div className="flex flex-col gap-2 border-t border-line px-5 py-3">
              <RateControl
                key={`${goal.id}:${override ?? ''}`}
                goal={goal}
                override={override}
                onChange={onRateChange}
              />
              <RateLine goal={goal} />
            </div>
          </Panel>
        </div>
      ) : (
        <div className="flex flex-col gap-1 rounded-panel border border-line bg-panel px-5 py-3 shadow-panel">
          <RateControl
            key={`${goal.id}:${override ?? ''}`}
            goal={goal}
            override={override}
            onChange={onRateChange}
          />
          <RateLine goal={goal} />
        </div>
      )}
    </div>
  );
};

const Empty = ({ scope }: { readonly scope: string }): React.ReactElement => (
  <section className="rounded-panel border border-line bg-panel p-8 text-center">
    <h2 className="text-panel-title font-semibold">Nenhum objetivo ainda</h2>
    <p className="mx-auto mt-2 max-w-prose text-[0.8125rem] text-ink-2">
      {scope} não tem objetivo de valor e prazo. Cada carteira tem um só: ele diz quanto
      você quer ter e quando, e esta tela responde se o ritmo atual chega lá.
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

export const GoalsView = ({
  resource,
  portfolioId,
  scopeLabel,
  rate,
  onRateChange,
}: GoalsViewProps): React.ReactElement => {
  const { state, pending, reload } = resource;
  const { hidden, toggleHidden } = usePreferences();
  const [dialog, setDialog] = useState<'edit' | 'delete' | null>(null);

  if (state.kind === 'loading') {
    return (
      <SkeletonRegion label="Carregando os objetivos" className="flex flex-col gap-4">
        <SkeletonHeader />
        <SkeletonPanel title="Objetivo">
          <SkeletonTable rows={3} columns={4} />
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
            {scopeLabel} · o objetivo de valor e prazo desta carteira
          </p>
        </div>
        <div className="flex items-center gap-2">
          <IconButton
            label={hidden ? 'Mostrar valores' : 'Ocultar valores'}
            aria-pressed={hidden}
            onClick={toggleHidden}
          >
            <Icon name={hidden ? 'eye-off' : 'eye'} />
          </IconButton>
          {data.goal === null ? (
            <Button variant="primary" icon="plus" onClick={() => setDialog('edit')}>
              Novo objetivo
            </Button>
          ) : null}
        </div>
      </header>

      {data.goal === null ? (
        <Empty scope={data.scope.name} />
      ) : (
        <KeepPrevious pending={pending} className="flex flex-col gap-4">
          <GoalPanel
            goal={data.goal}
            scopeLabel={scopeLabel}
            override={rate ?? undefined}
            onRateChange={onRateChange}
            onEdit={() => setDialog('edit')}
          />
        </KeepPrevious>
      )}

      {dialog === 'edit' ? (
        <GoalDialog
          portfolioId={portfolioId}
          scopeLabel={data.scope.name}
          goal={data.goal}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            reload();
          }}
          onDelete={() => setDialog('delete')}
        />
      ) : null}

      {dialog === 'delete' && data.goal !== null ? (
        <DeleteDialog
          title={`Excluir ${data.goal.name}?`}
          subtitle="Esta ação não pode ser desfeita"
          subject={`o objetivo ${data.goal.name}`}
          consequence="Posições, lançamentos e patrimônio não mudam: o objetivo só media a carteira."
          confirmLabel="Excluir objetivo"
          onConfirm={() => deleteGoal(portfolioId)}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            reload();
          }}
        />
      ) : null}
    </div>
  );
};
