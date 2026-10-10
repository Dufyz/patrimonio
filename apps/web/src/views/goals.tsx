import type { GoalResource, GoalsResource } from '@patrimonio/contracts';
import type { DateOnly } from '@patrimonio/domain';
import { useCallback, useState } from 'react';
import { useSearchParams } from 'react-router';

import { fetchGoals } from '../api/goals.js';
import { GoalProgressBar } from '../components/bars.js';
import { Money, Percent } from '../components/number.js';
import { KeepPrevious } from '../components/pending.js';
import { usePreferences } from '../components/preferences.js';
import { Button, IconButton, Label, Panel } from '../components/primitives.js';
import { SeriesChart } from '../components/series_chart.js';
import {
  BLOCK_REASON,
  KIND_LABEL,
  STATUS_LABEL,
  arrivalText,
  barState,
  chartSeries,
  decodeRates,
  encodeRates,
  goalCaptionTail,
  monthYearLabel,
  normalizeRateInput,
  paceLabel,
  rowTone,
  withRate,
} from '../lib/goals.js';
import { formatDate, monthTicks, percentAsRatio } from '../lib/overview.js';
import type { Resource } from '../lib/use_resource.js';
import { useResource } from '../lib/use_resource.js';

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
  readonly scopeLabel: string;
  readonly rates: Readonly<Record<string, string>>;
  readonly onRateChange: (goalId: string, rate: string | null) => void;
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
  const rates = decodeRates(params.get('taxa'));
  const key = encodeRates(rates) ?? '';

  const onRateChange = useCallback(
    (goalId: string, rate: string | null) =>
      setParams(
        (current) => {
          const search = new URLSearchParams(current);
          const encoded = encodeRates(
            withRate(decodeRates(current.get('taxa')), goalId, rate),
          );
          if (encoded === null) search.delete('taxa');
          else search.set('taxa', encoded);
          return search;
        },
        { replace: true },
      ),
    [setParams],
  );

  const resource = useResource(
    (signal) => fetchGoals({ portfolioId, rates }, signal),
    [portfolioId, key],
  );

  return (
    <GoalsView
      resource={resource}
      scopeLabel={scopeLabel}
      rates={rates}
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

const ContributionTable = ({
  goal,
}: {
  readonly goal: GoalResource;
}): React.ReactElement => (
  <div>
    <Label>Se eu aportar por mês</Label>
    <table className="mt-2 w-full border-collapse border border-line text-[0.8125rem]">
      <caption className="sr-only">Aporte mensal e data de chegada</caption>
      <thead>
        <tr className="bg-panel-2 text-label tracking-wide text-ink-3 uppercase">
          <th scope="col" className="px-3 py-2 text-left font-medium">
            Aporte
          </th>
          <th scope="col" className="px-3 py-2 text-right font-medium">
            Atinge em
          </th>
        </tr>
      </thead>
      <tbody>
        {goal.contributions.map((row) => {
          const arrival = arrivalText(row.months_to_arrival, row.arrival_date);
          const tone = rowTone(row);
          const note =
            row.kind === 'current'
              ? paceLabel(goal.pace.months_measured)
              : KIND_LABEL[row.kind];

          return (
            <tr
              key={`${row.kind}:${row.monthly_contribution}`}
              className="h-(--row-height) border-t border-line"
            >
              <td className="px-3">
                <Money value={row.monthly_contribution} decimals={0} />
                {note === '' ? null : <span className="ml-2 text-ink-3">{note}</span>}
              </td>
              <td
                className={`tabular px-3 text-right ${
                  tone === 'positive'
                    ? 'text-positive'
                    : tone === 'negative'
                      ? 'text-negative'
                      : 'text-attention'
                }`}
              >
                {arrival.text}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  </div>
);

const GoalPanel = ({
  goal,
  override,
  onRateChange,
}: {
  readonly goal: GoalResource;
  readonly override: string | undefined;
  readonly onRateChange: (rate: string | null) => void;
}): React.ReactElement => {
  const series = chartSeries(goal);
  const dates = (goal.chart?.dates ?? []) as DateOnly[];
  const ticks = monthTicks(dates);

  return (
    <Panel
      title={goal.name}
      hint={
        <>
          <Money value={goal.target_amount} decimals={0} />{' '}
          {goal.amount_in_today_brl ? 'em reais de hoje' : 'em reais da data alvo'} ·{' '}
          {goalCaptionTail(goal)}
        </>
      }
      action={
        <Button disabled title="Editar objetivo chega com T-10">
          Editar
        </Button>
      }
    >
      <div className="flex flex-col gap-4 p-4">
        <GoalProgressBar
          label={STATUS_LABEL[goal.status]}
          progress={percentAsRatio(goal.progress_pct)}
          expected={percentAsRatio(goal.expected_pct)}
          state={barState(goal.status)}
        />
        <p className="flex flex-wrap justify-between gap-2 text-[0.8125rem]">
          <span>
            <Money value={goal.current_value} decimals={0} />
            <span className="text-ink-3">
              {' '}
              · <Percent value={percentAsRatio(goal.progress_pct)} decimals={1} />
              {goal.as_of === null
                ? ' · sem fechamento'
                : ` · ${formatDate(goal.as_of as DateOnly)}`}
            </span>
          </span>
          <span className="text-ink-3">
            {goal.expected_pct === null ? null : (
              <>
                esperado hoje{' '}
                <Percent value={percentAsRatio(goal.expected_pct)} decimals={1} />
                {' · '}
              </>
            )}
            {goal.surplus_brl === null ? (
              <>
                faltam <Money value={goal.remaining_brl} decimals={0} />
              </>
            ) : (
              <>
                excedente <Money value={goal.surplus_brl} decimals={0} />
              </>
            )}
          </span>
        </p>

        {goal.blocked !== null ? (
          <p
            role="status"
            className="rounded-control bg-attention-soft p-3 text-[0.8125rem] text-attention"
          >
            {BLOCK_REASON[goal.blocked]}
          </p>
        ) : goal.status === 'reached' ? (
          <p role="status" className="text-[0.8125rem] text-positive">
            Meta atingida: não há o que projetar.
          </p>
        ) : goal.status === 'overdue' ? (
          <p role="status" className="text-[0.8125rem] text-negative">
            O prazo de {monthYearLabel(goal.target_date)} passou e a meta não foi
            atingida. Edite a data para voltar a projetar.
          </p>
        ) : null}

        {goal.chart !== null && goal.projection !== null ? (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_22rem]">
            <div>
              <SeriesChart
                dates={dates}
                series={series}
                valueFormat="money"
                fromZero
                ariaLabel={`Trajetória de ${goal.name}`}
                xTickLabel={(date) => ticks.get(date) ?? ''}
                tooltipDateLabel={(date) => monthYearLabel(date)}
                reference={{
                  value: goal.target_amount,
                  label: 'meta',
                  color: 'var(--color-ink-3)',
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
            <ContributionTable goal={goal} />
          </div>
        ) : null}

        <div className="flex flex-col gap-1">
          <RateControl
            key={`${goal.id}:${override ?? ''}`}
            goal={goal}
            override={override}
            onChange={onRateChange}
          />
          <RateLine goal={goal} />
        </div>
      </div>
    </Panel>
  );
};

const Empty = ({ scope }: { readonly scope: string }): React.ReactElement => (
  <section className="rounded-panel border border-line bg-panel p-8 text-center">
    <h2 className="text-panel-title font-semibold">Nenhum objetivo ainda</h2>
    <p className="mx-auto mt-2 max-w-prose text-[0.8125rem] text-ink-2">
      {scope} não tem metas de valor e prazo. Um objetivo diz quanto você quer ter e
      quando, e esta tela responde se o ritmo atual chega lá.
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
  scopeLabel,
  rates,
  onRateChange,
}: GoalsViewProps): React.ReactElement => {
  const { state, pending, reload } = resource;
  const { hidden, toggleHidden } = usePreferences();

  if (state.kind === 'loading') {
    return (
      <p aria-busy="true" className="p-8 text-center text-[0.8125rem] text-ink-3">
        Carregando os objetivos…
      </p>
    );
  }
  if (state.kind === 'error') return <Failed error={state.error} onRetry={reload} />;

  const data = state.value;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-screen-title font-semibold tracking-tight">Objetivos</h1>
          <p className="truncate text-[0.8125rem] text-ink-2">
            {scopeLabel} · metas de valor e prazo · posição de{' '}
            {formatDate(data.reference_date as DateOnly)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <IconButton
            label={hidden ? 'Mostrar valores' : 'Ocultar valores'}
            aria-pressed={hidden}
            onClick={toggleHidden}
          >
            <span aria-hidden="true">{hidden ? '◌' : '◉'}</span>
          </IconButton>
          <Button variant="primary" disabled title="Criar objetivo chega com T-10">
            + Novo objetivo
          </Button>
        </div>
      </header>

      {data.goals.length === 0 ? (
        <Empty scope={data.scope.name} />
      ) : (
        <KeepPrevious pending={pending} className="flex flex-col gap-4">
          {data.goals.map((goal) => (
            <GoalPanel
              key={goal.id}
              goal={goal}
              override={rates[goal.id]}
              onRateChange={(rate) => onRateChange(goal.id, rate)}
            />
          ))}
        </KeepPrevious>
      )}
    </div>
  );
};
