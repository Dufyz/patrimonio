import { SkeletonRegion, SkeletonTable } from '../../components/skeleton.js';
import type { GoalsOverviewResource } from '@patrimonio/contracts';
import { Link } from 'react-router';

import { Money, Percent } from '../../components/number.js';
import { Panel } from '../../components/primitives.js';
import { FinTable, Th, THead } from '../../components/table_parts.js';
import { STATUS_LABEL, monthYearLabel } from '../../lib/goals.js';
import { percentAsRatio } from '../../lib/overview.js';
import { PanelHeaderAction } from '../../finance/components/overview_panels.js';
import { WeightBar } from './alocacao_panel.js';
import type { Resource } from '../../lib/use_resource.js';

/**
 * VGR-08 · Objetivos, na forma das pranchas 1.1, 1.3 e 1.4: uma linha por
 * objetivo (Objetivo · Atual · Meta · Progresso, com a situação sob o
 * percentual) e, no rodapé, o que o objetivo pede por mês contra o ritmo atual.
 * Numa carteira sem objetivo o painel não some: diz isso e oferece defini-lo.
 */

const DOT: Readonly<Record<string, string>> = {
  on_track: 'bg-positive',
  reached: 'bg-positive',
  behind: 'bg-attention',
  overdue: 'bg-negative',
  no_projection: 'bg-ink-3',
};

export const ObjetivosPanel = ({
  goals,
  portfolioId,
  seeHref,
  defineHref,
}: {
  readonly goals: Resource<GoalsOverviewResource>;
  /** Nulo é Todas as carteiras. */
  readonly portfolioId: string | null;
  /** O link "Ver" do título, quando há objetivo. */
  readonly seeHref: string;
  /** Para onde "Definir objetivo" leva, numa carteira sem objetivo. */
  readonly defineHref?: string | undefined;
}): React.ReactElement => {
  const state = goals.state;
  const title = portfolioId === null ? 'Objetivos' : 'Objetivo';

  if (state.kind !== 'ready') {
    return (
      <Panel title={title} className="flex flex-col">
        {state.kind === 'loading' ? (
          <SkeletonRegion label="Carregando os objetivos">
            <SkeletonTable rows={2} columns={4} />
          </SkeletonRegion>
        ) : (
          <p
            role="alert"
            className="flex flex-wrap items-center gap-3 p-4 text-[0.8125rem] text-negative"
          >
            <span>Não foi possível carregar os objetivos: {state.error.message}</span>
            <button
              type="button"
              className="h-control cursor-pointer rounded-control border border-line px-3 text-ink hover:bg-panel-2"
              onClick={goals.reload}
            >
              Tentar novamente
            </button>
          </p>
        )}
      </Panel>
    );
  }

  const data = state.value;
  const rows = data.portfolios.filter(
    (row) =>
      row.goal !== null && (portfolioId === null || row.portfolio_id === portfolioId),
  );
  const own = portfolioId !== null && rows.length === 0;
  const hint =
    portfolioId === null
      ? `${rows.length} ${rows.length === 1 ? 'objetivo' : 'objetivos'}`
      : (data.portfolios.find((row) => row.portfolio_id === portfolioId)
          ?.portfolio_name ?? '');

  return (
    <Panel
      title={title}
      action={
        <PanelHeaderAction
          hint={hint}
          {...(rows.length === 0 ? {} : { more: { to: seeHref, label: 'Ver' } })}
        />
      }
      className="flex flex-col"
    >
      {own || rows.length === 0 ? (
        <div className="flex flex-1 flex-col items-start gap-2 p-5">
          <p className="text-[0.9375rem] font-semibold">
            {own
              ? 'Esta carteira não tem objetivo'
              : 'Nenhuma carteira tem objetivo definido'}
          </p>
          <p className="text-[0.8125rem] text-ink-3">
            Defina uma meta de valor e prazo para acompanhar o progresso, o ritmo e o
            aporte mensal necessário.
          </p>
          {defineHref === undefined ? null : (
            <Link
              to={defineHref}
              className="mt-1 inline-flex h-control cursor-pointer items-center rounded-control border border-line px-3 text-[0.8125rem] hover:bg-panel-2"
            >
              Definir objetivo
            </Link>
          )}
        </div>
      ) : (
        <>
          <FinTable caption="Objetivos" fill>
            <THead>
              <Th>Objetivo</Th>
              <Th align="right">Atual</Th>
              <Th align="right">Meta</Th>
              <Th align="right">Progresso</Th>
            </THead>
            <tbody>
              {rows.map((row) => {
                const goal = row.goal;
                if (goal === null) return null;
                return (
                  <tr key={row.portfolio_id} className="border-t border-line align-top">
                    <th scope="row" className="py-[var(--row-pad)] pl-3 text-left">
                      <span className="block font-semibold">{goal.name}</span>
                      <span className="block text-xs font-normal text-ink-3">
                        {row.portfolio_name} · {monthYearLabel(goal.target_date)}
                      </span>
                    </th>
                    <td className="tabular px-3 py-[var(--row-pad)] text-right">
                      <Money value={goal.current_value} />
                    </td>
                    <td className="tabular px-3 py-[var(--row-pad)] text-right">
                      <Money value={goal.target_amount} decimals={0} />
                    </td>
                    <td className="px-3 py-[var(--row-pad)] text-right">
                      <span className="inline-flex items-center gap-2">
                        <WeightBar
                          ratio={percentAsRatio(goal.progress_pct)}
                          className="w-12"
                        />
                        <Percent
                          value={percentAsRatio(goal.progress_pct)}
                          decimals={1}
                          className="font-semibold"
                        />
                      </span>
                      <span className="mt-0.5 flex items-center justify-end gap-1.5 text-xs font-medium">
                        <span
                          aria-hidden="true"
                          className={`size-1.5 rounded-full ${DOT[goal.status] ?? 'bg-ink-3'}`}
                        />
                        {STATUS_LABEL[goal.status]}
                      </span>
                    </td>
                  </tr>
                );
              })}
              <tr aria-hidden="true" className="h-full">
                <td colSpan={4} />
              </tr>
              {portfolioId !== null ? null : (
                <tr className="border-t border-line-2 bg-panel-2 font-semibold">
                  <th
                    scope="row"
                    className="py-[var(--row-pad)] pl-3 text-left font-[inherit]"
                  >
                    Total
                  </th>
                  <td className="tabular px-3 py-[var(--row-pad)] text-right">
                    <Money value={data.totals.current_value} />
                  </td>
                  <td className="tabular px-3 py-[var(--row-pad)] text-right">
                    <Money value={data.totals.target_amount} decimals={0} />
                  </td>
                  <td className="px-3 py-[var(--row-pad)] text-right">
                    <span className="inline-flex items-center gap-2">
                      <WeightBar
                        ratio={percentAsRatio(data.totals.progress_pct)}
                        className="w-12"
                      />
                      <Percent
                        value={percentAsRatio(data.totals.progress_pct)}
                        decimals={1}
                      />
                    </span>
                  </td>
                </tr>
              )}
            </tbody>
          </FinTable>
          <p className="border-t border-line px-4 py-3 text-[0.8125rem] text-ink-2">
            {footnote(data, portfolioId)}
          </p>
        </>
      )}
    </Panel>
  );
};

/** "Pede R$ 6.762/mês; no ritmo atual (R$ 4.272/mês) chega em mar/2032." */
const footnote = (
  data: GoalsOverviewResource,
  portfolioId: string | null,
): React.ReactNode => {
  const row =
    portfolioId === null
      ? null
      : data.portfolios.find((item) => item.portfolio_id === portfolioId);
  const required = row?.goal?.required_monthly ?? data.totals.required_monthly;
  const current = row?.goal?.current_monthly ?? data.totals.current_monthly;
  const arrival =
    row?.goal === undefined || row.goal === null
      ? data.totals.pace_arrival_date
      : row.goal.current_arrival_date;
  return (
    <>
      Pede <Money value={required} decimals={0} className="font-semibold" />
      /mês; no ritmo atual (
      <Money value={current} decimals={0} className="font-semibold" />
      /mês){' '}
      {arrival === null ? 'não chega em cem anos' : `chega em ${monthYearLabel(arrival)}`}
      .
    </>
  );
};
