import { Amount } from './amount.js';
import { StatStrip } from './stat_strip.js';
import { NatureTag } from './tags.js';
import type { MonthResult } from '../domain/overview.js';
import { formatDay, formatDayOfMonth, formatMonth } from '../lib/format.js';
import { pluralize } from '../lib/header.js';
import { formatRange, isWholeMonth } from '../lib/period.js';
import type { DateRange } from '../lib/period.js';

/**
 * FIN-601 · Faixa de totais do mês: o resultado do período e a posição de hoje.
 * Receitas, despesas e saldo seguem o período; Em contas e Faturas abertas
 * refletem hoje.
 */
export const OverviewStrip = ({
  result,
  range,
  today,
}: {
  readonly result: MonthResult;
  readonly range: DateRange;
  readonly today: string;
}): React.ReactElement => {
  const includesToday = range.from <= today && today <= range.to;
  const title = isWholeMonth(range)
    ? `Resultado de ${formatMonth(range.from)}`
    : `Resultado de ${formatRange(range, today)}`;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-[0.9375rem] font-semibold">{title}</h2>
          {includesToday ? <NatureTag kind="mês em andamento" /> : null}
        </div>
        {includesToday ? (
          <span className="tabular text-xs text-ink-3">{formatDayOfMonth(today)}</span>
        ) : null}
      </div>
      <StatStrip
        label="Resultado do mês"
        cells={[
          {
            id: 'receitas',
            label: 'Receitas',
            value: (
              <Amount
                cents={result.receitas.cents}
                variant="flow"
                className="text-positive"
              />
            ),
            caption: pluralize(result.receitas.count, 'lançamento', 'lançamentos'),
          },
          {
            id: 'despesas',
            label: 'Despesas',
            value: <Amount cents={-result.despesas.cents} variant="signed" />,
            caption: pluralize(result.despesas.count, 'lançamento', 'lançamentos'),
          },
          {
            id: 'saldo',
            label: 'Saldo do mês',
            value: <Amount cents={result.saldo} variant="signed" />,
            caption: 'receitas – despesas',
          },
          {
            id: 'contas',
            label: 'Em contas',
            value: <Amount cents={result.accountsCents} />,
            caption: pluralize(result.accountsCount, 'conta', 'contas'),
          },
          {
            id: 'faturas',
            label: 'Faturas abertas',
            value: <Amount cents={result.invoicesCents} />,
            caption:
              result.dueByAccount.length === 0
                ? 'nada a pagar'
                : result.dueByAccount
                    .map((item) => `${item.name} ${formatDay(item.due, today)}`)
                    .join(' · '),
          },
        ]}
      />
    </div>
  );
};
