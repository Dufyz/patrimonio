import type { GoalsOverviewResource } from '@patrimonio/contracts';

import { GoalProgressBar } from '../components/bars.js';
import { Icon } from '../components/icon.js';
import { Money } from '../components/number.js';
import { STATUS_LABEL, barState, monthYearLabel } from '../lib/goals.js';
import type { Resource } from '../lib/use_resource.js';

/**
 * IVG-004 · Objetivos: os objetivos cadastrados nas carteiras, um por linha,
 * com o progresso de cada um. A lista é a mesma nos dois escopos; numa carteira
 * o objetivo dela fica destacado, e uma carteira sem objetivo diz isso e
 * oferece criar um. O painel nunca some: o layout é o mesmo.
 */
export const GoalPanelBody = ({
  goals,
  portfolioId,
  onOpenGoals,
}: {
  readonly goals: Resource<GoalsOverviewResource> | null;
  /** Nulo é Todas as carteiras. */
  readonly portfolioId: string | null;
  readonly onOpenGoals?: (() => void) | undefined;
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

  const define = (
    <button
      type="button"
      className="inline-flex h-control cursor-pointer items-center gap-2 rounded-control border border-line px-3 text-[0.8125rem] hover:bg-panel-2"
      onClick={onOpenGoals}
    >
      <Icon name="plus" size={14} />
      Definir objetivo
    </button>
  );

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
              <GoalProgressBar
                label={goal.name}
                caption={`${row.portfolio_name} · ${STATUS_LABEL[goal.status]} · prazo ${monthYearLabel(goal.target_date)}`}
                progress={goal.progress_pct}
                expected={goal.expected_pct}
                state={barState(goal.status)}
              />
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
        {missingOwn ? (
          <>
            <span className="text-[0.8125rem] text-ink-3">
              Esta carteira não tem objetivo.
            </span>
            {define}
          </>
        ) : withGoal.length === 0 ? (
          define
        ) : (
          <span className="text-xs text-ink-3">
            {withGoal.length} {withGoal.length === 1 ? 'objetivo' : 'objetivos'} · último
            prazo {monthYearLabel(data.totals.last_target_date)}
          </span>
        )}
      </div>
    </div>
  );
};
