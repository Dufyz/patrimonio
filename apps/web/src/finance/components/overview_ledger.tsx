import { Link } from 'react-router';

import { Panel } from '../../components/primitives.js';
import { cn } from '../../lib/cn.js';
import { accountNames } from '../domain/ledger.js';
import type { Entry, FinanceData } from '../domain/types.js';
import { formatDay } from '../lib/format.js';
import { financeRoutes } from '../lib/routes.js';
import { Amount } from './amount.js';

/**
 * FIN-604 · Card Lançamentos da Visão geral: os últimos lançados e os próximos
 * previstos do período, cada um com ponto de situação.
 */

const EntryLine = ({
  entry,
  data,
  today,
}: {
  readonly entry: Entry;
  readonly data: FinanceData;
  readonly today: string;
}): React.ReactElement => {
  const category = data.categories.find((c) => c.id === entry.categoryId);
  const posted = entry.status === 'lancada';
  const cents = entry.kind === 'receita' ? entry.cents : -entry.cents;
  return (
    <li className="flex items-start gap-3 border-b border-line px-5 py-2.5 last:border-b-0">
      <span
        aria-hidden="true"
        data-status={entry.status}
        className={cn(
          'mt-1.5 inline-block size-2 shrink-0 rounded-full',
          posted ? 'bg-positive' : 'bg-ink-3',
        )}
      />
      <div className="min-w-0 flex-1">
        <div className="truncate">{entry.description}</div>
        <div className="truncate text-xs text-ink-3">
          {[
            formatDay(entry.date, today),
            accountNames(data, entry).join(' + '),
            category?.name,
          ]
            .filter((part): part is string => part !== undefined && part !== '')
            .join(' · ')}
        </div>
      </div>
      <span className="font-semibold">
        <Amount cents={cents} variant={entry.kind === 'receita' ? 'flow' : 'signed'} />
      </span>
    </li>
  );
};

const Section = ({
  title,
  note,
}: {
  readonly title: string;
  readonly note: string;
}): React.ReactElement => (
  <li className="flex items-baseline justify-between border-y border-line bg-panel-2 px-5 py-2 first:border-t-0">
    <span className="tabular text-label tracking-[0.08em] text-ink-3 uppercase">
      {title}
    </span>
    <span className="tabular text-label tracking-[0.08em] text-ink-3 uppercase">
      {note}
    </span>
  </li>
);

export const OverviewLedger = ({
  data,
  posted,
  planned,
  today,
}: {
  readonly data: FinanceData;
  readonly posted: readonly Entry[];
  readonly planned: readonly Entry[];
  readonly today: string;
}): React.ReactElement => (
  <Panel
    title="Lançamentos"
    action={
      <span className="text-xs text-ink-3">últimos lançados e próximos previstos</span>
    }
  >
    <ul aria-label="Lançamentos do período">
      <Section title="Lançados" note="mais recentes primeiro" />
      {posted.length === 0 ? (
        <li className="px-5 py-3 text-[0.8125rem] text-ink-3">
          Nenhum lançado no período.
        </li>
      ) : (
        posted.map((entry) => (
          <EntryLine key={entry.id} entry={entry} data={data} today={today} />
        ))
      )}
      <Section title="Previstos" note="ainda não lançados" />
      {planned.length === 0 ? (
        <li className="px-5 py-3 text-[0.8125rem] text-ink-3">
          Nenhum previsto no período.
        </li>
      ) : (
        planned.map((entry) => (
          <EntryLine key={entry.id} entry={entry} data={data} today={today} />
        ))
      )}
    </ul>
    <footer className="border-t border-line px-5 py-3.5">
      <Link
        to={financeRoutes.entries()}
        className="text-[0.8125rem] text-accent hover:underline"
      >
        Ver todos os lançamentos
      </Link>
    </footer>
  </Panel>
);
