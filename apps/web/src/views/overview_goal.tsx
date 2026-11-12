import type { GoalsOverviewResource } from '@patrimonio/contracts';

import { GoalProgressBar } from '../components/bars.js';
import { Money } from '../components/number.js';
import { Icon } from '../components/icon.js';
import { STATUS_LABEL, barState, monthYearLabel } from '../lib/goals.js';
import type { Resource } from '../lib/use_resource.js';

/**
 * IVG-004 · Independência financeira: o objetivo da carteira, ou o conjunto
 * dos objetivos em Todas as carteiras. Uma carteira sem objetivo diz isso e
 * oferece criar um; o painel nunca some, porque o layout é o mesmo nos dois
 * escopos.
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
    return <p className="p-4 text-[0.8125rem] text-ink-3">Carregando o objetivo…</p>;
  }

  if (goals.state.kind === 'error') {
    return (
      <p
        role="alert"
        className="flex flex-wrap items-center gap-3 p-4 text-[0.8125rem] text-negative"
      >
        <span>Não foi possível carregar o objetivo: {goals.state.error.message}</span>
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

  if (portfolioId === null) {
    const { totals } = data;
    if (totals.goals === 0) {
      return (
        <div className="flex flex-col items-start gap-3 p-4">
          <p className="text-[0.8125rem] text-ink-3">
            Nenhuma carteira tem objetivo definido.
          </p>
          {define}
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-3 p-4">
        <GoalProgressBar
          label={`${totals.goals} ${totals.goals === 1 ? 'objetivo' : 'objetivos'}`}
          caption={`Último prazo ${monthYearLabel(totals.last_target_date)}`}
          progress={totals.progress_pct}
          expected={totals.expected_pct}
        />
        <p className="text-[0.8125rem] text-ink-2">
          <Money value={totals.current_value} /> de <Money value={totals.target_amount} />
        </p>
      </div>
    );
  }

  const goal =
    data.portfolios.find((row) => row.portfolio_id === portfolioId)?.goal ?? null;
  if (goal === null) {
    return (
      <div className="flex flex-col items-start gap-3 p-4">
        <p className="text-[0.8125rem] text-ink-3">Esta carteira não tem objetivo.</p>
        {define}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <GoalProgressBar
        label={goal.name}
        caption={`${STATUS_LABEL[goal.status]} · prazo ${monthYearLabel(goal.target_date)}`}
        progress={goal.progress_pct}
        expected={goal.expected_pct}
        state={barState(goal.status)}
      />
      <p className="text-[0.8125rem] text-ink-2">
        <Money value={goal.current_value} /> de <Money value={goal.target_amount} /> ·
        faltam <Money value={goal.remaining_brl} />
      </p>
    </div>
  );
};
