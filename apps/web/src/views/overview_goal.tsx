import type { GoalsOverviewResource } from '@patrimonio/contracts';

import { Money } from '../components/number.js';
import { STATUS_LABEL, monthYearLabel } from '../lib/goals.js';
import type { Resource } from '../lib/use_resource.js';
import { GoalTrack } from './goals.js';

/**
 * IVG-004 · Objetivos: os objetivos cadastrados nas carteiras, um por linha,
 * com o progresso de cada um. A lista é a mesma nos dois escopos; numa carteira
 * o objetivo dela fica destacado, e uma carteira sem objetivo diz isso e
 * oferece criar um. O painel nunca some: o layout é o mesmo.
 */
export const GoalPanelBody = ({
  goals,
  portfolioId,
}: {
  readonly goals: Resource<GoalsOverviewResource> | null;
  /** Nulo é Todas as carteiras. */
  readonly portfolioId: string | null;
}): React.ReactElement => {
  if (goals === null || goals.state.kind === 'loading') {
    return <p className="p-4 text-[0.8125rem] text-ink-3">Carregando os objetivos…</p>;
  }

  if (goals.state.kind === 'error') {
    return (
      <p
        role="alert"
        className="flex flex-wrap items-center gap-3 p-4 text-[0.8125rem] text-negative"
      >
        <span>Não foi possível carregar os objetivos: {goals.state.error.message}</span>
        <button
          type="button"
          className="h-control cursor-pointer rounded-control border border-line px-3 text-ink hover:bg-panel-2"
          onClick={goals.reload}
        >
          Tentar de novo
        </button>
      </p>
    );
  }

  const data = goals.state.value;
  const withGoal = data.portfolios.filter((row) => row.goal !== null);
  const own =
    portfolioId === null
      ? null
      : data.portfolios.find((row) => row.portfolio_id === portfolioId);
  const missingOwn = portfolioId !== null && (own == null || own.goal === null);

  return (
    <div className="flex flex-1 flex-col">
      <ul className="flex flex-col gap-5 p-4">
        {withGoal.map((row) => {
          const goal = row.goal;
          if (goal === null) return null;
          const selected = row.portfolio_id === portfolioId;
          return (
            <li
              key={row.portfolio_id}
              aria-current={selected ? 'true' : undefined}
              className={selected ? '-mx-2 rounded-control bg-panel-2 px-2 py-2' : ''}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="truncate text-[0.8125rem] font-medium">{goal.name}</span>
                <span
                  className={`text-xs ${
                    goal.status === 'behind' ? 'text-negative' : 'text-ink-3'
                  }`}
                >
                  {STATUS_LABEL[goal.status]} · prazo {monthYearLabel(goal.target_date)}
                </span>
              </div>
              <p className="text-xs text-ink-3">{row.portfolio_name}</p>
              <GoalTrack goal={goal} className="pt-2 pb-0" />
              <p className="mt-1 text-xs text-ink-3">
                <Money value={goal.current_value} /> de{' '}
                <Money value={goal.target_amount} /> · faltam{' '}
                <Money value={goal.remaining_brl} />
              </p>
            </li>
          );
        })}
      </ul>

      {withGoal.length === 0 && portfolioId === null ? (
        <p className="px-4 pb-4 text-[0.8125rem] text-ink-3">
          Nenhuma carteira tem objetivo definido.
        </p>
      ) : null}

      <div className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3">
        <span className="text-xs text-ink-3">
          {missingOwn
            ? 'Esta carteira não tem objetivo.'
            : withGoal.length === 0
              ? 'Nenhum objetivo definido.'
              : `${withGoal.length} ${withGoal.length === 1 ? 'objetivo' : 'objetivos'} · último prazo ${monthYearLabel(data.totals.last_target_date)}`}
        </span>
      </div>
    </div>
  );
};
