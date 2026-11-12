import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';

import { Panel } from '../../components/primitives.js';
import { useElementWidth } from '../../components/use_element_width.js';
import { useValuesHidden } from '../../components/preferences.js';
import { cn } from '../../lib/cn.js';
import { accountsOverview } from '../domain/accounts.js';
import { cardSummary, openInvoicesTotal } from '../domain/cards.js';
import { cashOutlook, defaultHorizon } from '../domain/cash_flow.js';
import { categoryBreakdown } from '../domain/overview.js';
import { effectiveDate, realizedBalances } from '../domain/projection.js';
import type { Entry, FinanceData } from '../domain/types.js';
import { categoryColor } from '../lib/category_colors.js';
import { compareDates, endOfMonth, startOfMonth } from '../lib/dates.js';
import type { IsoDate } from '../lib/dates.js';
import {
  formatBRL,
  formatDay,
  formatDayOfMonth,
  formatMonth,
  formatPercentTenths,
} from '../lib/format.js';
import { limitTone } from '../lib/limit.js';
import { sum } from '../lib/money.js';
import type { Cents } from '../lib/money.js';
import { formatRange, isWholeMonth } from '../lib/period.js';
import type { DateRange } from '../lib/period.js';
import { financeRoutes } from '../lib/routes.js';
import { Amount } from './amount.js';
import { CategoryMarker, FinTable, Row, Td, Th, THead } from './fin_table.js';
import { formatPercentValue } from './limit_bar.js';
import { EmptyPanel } from './states.js';

/**
 * FVG-001 a FVG-006 · Os painéis da Visão geral de Finanças. Geral reaproveita
 * os mesmos componentes (GER-008), com os mesmos dados.
 */

const LINK = 'cursor-pointer text-[0.8125rem] text-accent hover:underline';

const TAG =
  'tabular rounded-control bg-panel-2 px-1.5 py-0.5 text-label font-semibold text-ink-3';

/** Uma linha com barra: rótulo, barra proporcional e valor. */
const BarRow = ({
  label,
  cents,
  max,
  tone,
  sign,
  to,
}: {
  readonly label: string;
  readonly cents: Cents;
  readonly max: Cents;
  readonly tone: 'neutral' | 'positive' | 'negative' | 'muted';
  readonly sign: '+' | '−' | '';
  readonly to?: string | undefined;
}): React.ReactElement => {
  const fill = {
    neutral: 'bg-ink',
    positive: 'bg-positive',
    negative: 'bg-negative',
    muted: 'bg-ink-3',
  }[tone];
  const text = {
    neutral: '',
    positive: 'text-positive',
    negative: '',
    muted: '',
  }[tone];
  const width = max <= 0 ? 0 : Math.min(100, Math.max(0, (cents / max) * 100));
  const content = (
    <>
      <span className="w-40 shrink-0 text-[0.8125rem] text-ink-2">{label}</span>
      <span
        aria-hidden="true"
        className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-line"
      >
        <span
          className={cn('absolute inset-y-0 left-0 rounded-full', fill)}
          style={{ width: `${width}%` }}
        />
      </span>
      <span className={cn('tabular w-36 shrink-0 text-right text-[0.8125rem]', text)}>
        {sign}
        <Amount cents={cents} />
      </span>
    </>
  );
  return to === undefined ? (
    <div className="flex items-center gap-3 py-2">{content}</div>
  ) : (
    <Link
      to={to}
      className="-mx-2 flex cursor-pointer items-center gap-3 rounded-control px-2 py-2 hover:bg-panel-2"
    >
      {content}
    </Link>
  );
};

/* -------------------------------------------------------------------------- */
/* FVG-001 e FVG-002 · Saldo previsto                                         */

const CHART_HEIGHT = 150;
const CHART_MARGIN = { top: 10, right: 12, bottom: 22, left: 12 } as const;

type Point = { readonly date: IsoDate; readonly cents: Cents };

const SaldoChart = ({
  realized,
  projected,
  today,
  lowest,
}: {
  readonly realized: readonly Point[];
  readonly projected: readonly Point[];
  readonly today: IsoDate;
  readonly lowest: Point;
}): React.ReactElement => {
  const container = useRef<HTMLDivElement>(null);
  const width = useElementWidth(container, 560);
  const hidden = useValuesHidden();
  const [hover, setHover] = useState<number | null>(null);

  const all = useMemo(
    () => [...realized.slice(0, -1), ...projected],
    [realized, projected],
  );
  const plotWidth = Math.max(1, width - CHART_MARGIN.left - CHART_MARGIN.right);
  const plotHeight = CHART_HEIGHT - CHART_MARGIN.top - CHART_MARGIN.bottom;
  const values = all.map((point) => point.cents);
  const low = Math.min(...values, 0);
  const high = Math.max(...values, 1);
  const x = (index: number): number =>
    all.length <= 1 ? 0 : (index / (all.length - 1)) * plotWidth;
  const y = (cents: number): number =>
    plotHeight - ((cents - low) / Math.max(1, high - low)) * plotHeight;

  const todayIndex = Math.max(
    0,
    all.findIndex((point) => point.date === today),
  );
  const path = (from: number, to: number): string =>
    all
      .slice(from, to + 1)
      .map(
        (point, offset) =>
          `${offset === 0 ? 'M' : 'L'}${x(from + offset).toFixed(1)},${y(point.cents).toFixed(1)}`,
      )
      .join(' ');
  const lowIndex = all.findIndex((point) => point.date === lowest.date);
  const hovered = hover === null ? null : (all[hover] ?? null);

  const ticks = useMemo(() => {
    const seen = new Set<string>();
    const out: { index: number; label: string }[] = [];
    all.forEach((point, index) => {
      const key = point.date.slice(0, 7);
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ index, label: formatMonth(point.date).slice(0, 3) });
    });
    return out;
  }, [all]);

  return (
    <div ref={container} className="relative">
      <svg
        role="img"
        aria-label="Saldo em contas: realizado até hoje e previsto depois"
        width={width}
        height={CHART_HEIGHT}
      >
        <g transform={`translate(${CHART_MARGIN.left},${CHART_MARGIN.top})`}>
          <path
            d={path(0, todayIndex)}
            fill="none"
            stroke="var(--color-ink)"
            strokeWidth={1.75}
          />
          <path
            d={path(todayIndex, all.length - 1)}
            fill="none"
            stroke="var(--color-accent)"
            strokeWidth={1.75}
            strokeDasharray="4 3"
          />
          <line
            x1={x(todayIndex)}
            x2={x(todayIndex)}
            y1={0}
            y2={plotHeight}
            stroke="var(--color-line-2)"
          />
          <text x={x(todayIndex) + 4} y={10} className="fill-ink-3 text-[10px]">
            hoje
          </text>
          {lowIndex >= 0 ? (
            <circle
              cx={x(lowIndex)}
              cy={y(lowest.cents)}
              r={3.5}
              fill="var(--color-negative)"
              aria-label="Menor saldo"
            />
          ) : null}
          {ticks.map((tick) => (
            <text
              key={tick.index}
              x={x(tick.index)}
              y={plotHeight + 15}
              className="tabular fill-ink-3 text-[10px]"
            >
              {tick.label}
            </text>
          ))}
          <rect
            x={0}
            y={0}
            width={plotWidth}
            height={plotHeight}
            fill="transparent"
            onMouseMove={(event) => {
              const box = event.currentTarget.getBoundingClientRect();
              const ratio = box.width === 0 ? 0 : (event.clientX - box.left) / box.width;
              setHover(
                Math.max(
                  0,
                  Math.min(all.length - 1, Math.round(ratio * (all.length - 1))),
                ),
              );
            }}
            onMouseLeave={() => setHover(null)}
          />
        </g>
      </svg>
      {hovered === null ? null : (
        <div
          role="status"
          className="tabular pointer-events-none absolute top-1 right-3 rounded-control border border-line bg-panel px-2 py-1 text-xs shadow-panel"
        >
          {formatDay(hovered.date, today)} · {hidden ? '•••' : formatBRL(hovered.cents)}
        </div>
      )}
    </div>
  );
};

export const SaldoPrevistoPanel = ({
  data,
  today,
}: {
  readonly data: FinanceData;
  readonly today: IsoDate;
}): React.ReactElement => {
  const monthEnd = endOfMonth(today);
  const horizon = defaultHorizon(today);
  const month = useMemo(
    () => cashOutlook(data, today, monthEnd),
    [data, today, monthEnd],
  );
  const long = useMemo(() => cashOutlook(data, today, horizon), [data, today, horizon]);
  const realized = useMemo(
    () => realizedBalances(data, startOfMonth(today), today),
    [data, today],
  );
  const max = Math.max(month.startCents, month.entradasCents, month.saidasCents, 1);

  return (
    <Panel
      title="Saldo previsto"
      hint={<span className={TAG}>{formatDayOfMonth(today)}</span>}
      action={
        <span className="text-xs text-ink-3">
          fim de {formatMonth(monthEnd).toLowerCase()}
        </span>
      }
      className="h-full"
    >
      <div className="flex flex-col gap-4 px-4 pt-4 pb-4">
        <div>
          <p className="tabular text-label tracking-[0.1em] text-ink-3 uppercase">
            Saldo ao fim do mês
          </p>
          <p className="tabular text-[2rem] leading-10 font-semibold">
            <Amount cents={month.endCents} />
          </p>
          <p className="text-xs text-ink-3">
            em {formatDay(horizon, today)}:{' '}
            <span className="tabular text-ink-2">
              <Amount cents={long.endCents} />
            </span>{' '}
            ·{' '}
            <span className="tabular">
              <Amount cents={long.variationCents} variant="delta" /> no período
            </span>
          </p>
        </div>

        <div className="flex flex-col">
          <BarRow
            label="Em contas hoje"
            cents={month.startCents}
            max={max}
            tone="neutral"
            sign=""
            to={financeRoutes.accounts()}
          />
          <BarRow
            label="Entradas previstas"
            cents={month.entradasCents}
            max={max}
            tone="positive"
            sign="+"
            to={financeRoutes.entries('tipo=receita&situacao=prevista')}
          />
          <BarRow
            label="Saídas previstas"
            cents={month.saidasCents}
            max={max}
            tone="negative"
            sign="−"
            to={financeRoutes.entries('tipo=despesa&situacao=prevista')}
          />
        </div>

        <SaldoChart
          realized={realized}
          projected={long.days}
          today={today}
          lowest={long.lowest}
        />

        <p className="flex items-baseline justify-between gap-3 border-t border-line pt-3 text-[0.8125rem] text-ink-2">
          <span>
            Menor saldo até {formatDay(horizon, today)}
            <span className="ml-2 text-ink-3">
              em {formatDay(long.lowest.date, today)}
            </span>
          </span>
          <span
            className={cn(
              'tabular font-semibold',
              long.lowest.cents < 0 && 'text-negative',
            )}
          >
            <Amount cents={long.lowest.cents} />
          </span>
        </p>
      </div>
    </Panel>
  );
};

/* -------------------------------------------------------------------------- */
/* FVG-003 · Despesas por categoria                                           */

export const DespesasCategoriaPanel = ({
  data,
  range,
  today,
}: {
  readonly data: FinanceData;
  readonly range: DateRange;
  readonly today: IsoDate;
}): React.ReactElement => {
  const breakdown = useMemo(() => categoryBreakdown(data, range), [data, range]);
  const includesToday =
    compareDates(range.from, today) <= 0 && compareDates(today, range.to) <= 0;
  const label = isWholeMonth(range) ? formatMonth(range.from) : formatRange(range, today);
  const total = sum(breakdown.rows.map((row) => row.cents));
  const lookup = (id: string) => data.categories.find((category) => category.id === id);

  return (
    <Panel
      title="Despesas por categoria"
      action={
        <span className="text-xs text-ink-3">
          {label}
          {includesToday ? ' · até agora' : ''}
        </span>
      }
      className="h-full"
    >
      {breakdown.rows.length === 0 ? (
        <EmptyPanel message="Nenhuma despesa lançada no período." />
      ) : (
        <>
          <FinTable caption="Despesas por categoria">
            <THead>
              <Th>Categoria</Th>
              <Th align="right">Despesa</Th>
              <Th align="right">% do total</Th>
            </THead>
            <tbody>
              {breakdown.rows.map((row) => {
                const category = lookup(row.categoryId);
                return (
                  <Row key={row.categoryId} label={category?.name ?? row.categoryId}>
                    <Td>
                      <CategoryMarker
                        color={categoryColor(category?.color)}
                        name={category?.name ?? row.categoryId}
                      />
                    </Td>
                    <Td numeric>
                      <Amount cents={row.cents} />
                    </Td>
                    <Td numeric>
                      <span className="inline-flex items-center justify-end gap-2.5">
                        <span className="relative h-1 w-20 overflow-hidden rounded-full bg-line">
                          <span
                            className="absolute inset-y-0 left-0 rounded-full bg-ink-3"
                            style={{ width: `${row.tenths / 10}%` }}
                          />
                        </span>
                        <span className="tabular w-12 text-right text-[0.8125rem]">
                          {formatPercentTenths(row.tenths)}
                        </span>
                      </span>
                    </Td>
                  </Row>
                );
              })}
              <tr className="border-t border-line bg-panel-2 font-semibold">
                <td className="px-3 py-[var(--row-pad)]">Total</td>
                <td className="tabular px-3 py-[var(--row-pad)] text-right">
                  <Amount cents={total} />
                </td>
                <td />
              </tr>
            </tbody>
          </FinTable>
          <footer className="px-4 py-3">
            <Link
              to={financeRoutes.entries(`tipo=despesa&situacao=lancada`)}
              className={LINK}
            >
              Ver por categoria
            </Link>
          </footer>
        </>
      )}
    </Panel>
  );
};

/* -------------------------------------------------------------------------- */
/* FVG-004 · Próximos lançamentos                                             */

const NEXT_ENTRIES = 9;

/** Os previstos, do mais próximo de hoje ao mais distante; os vencidos contam a partir de hoje (RN-13). */
export const plannedAhead = (data: FinanceData, today: IsoDate): readonly Entry[] =>
  data.entries
    .filter((entry) => entry.status === 'prevista' && entry.historical !== true)
    .sort(
      (a, b) =>
        compareDates(effectiveDate(a, today), effectiveDate(b, today)) ||
        compareDates(a.date, b.date) ||
        a.id.localeCompare(b.id),
    );

export const ProximosLancamentosPanel = ({
  data,
  today,
}: {
  readonly data: FinanceData;
  readonly today: IsoDate;
}): React.ReactElement => {
  const planned = useMemo(() => plannedAhead(data, today), [data, today]);
  const shown = planned.slice(0, NEXT_ENTRIES);
  const sourceName = (entry: Entry): string => {
    const id = entry.payments[0]?.sourceId;
    return (
      data.accounts.find((account) => account.id === id)?.name ??
      data.cards.find((card) => card.id === id)?.name ??
      '—'
    );
  };

  return (
    <Panel
      title="Próximos lançamentos"
      action={<span className="text-xs text-ink-3">o que ainda vai sair e entrar</span>}
      className="h-full"
    >
      {shown.length === 0 ? (
        <EmptyPanel message="Nada previsto." />
      ) : (
        <>
          <FinTable caption="Próximos lançamentos">
            <THead>
              <Th>Data</Th>
              <Th>Descrição</Th>
              <Th>Conta ou cartão</Th>
              <Th align="right">Valor</Th>
            </THead>
            <tbody>
              {shown.map((entry) => {
                const category = data.categories.find(
                  (item) => item.id === entry.categoryId,
                );
                const overdue = compareDates(entry.date, today) < 0;
                return (
                  <Row key={entry.id}>
                    <Td numeric className={cn('!text-left', overdue && 'text-negative')}>
                      {formatDay(entry.date, today)}
                    </Td>
                    <Td className="font-medium">
                      <CategoryMarker
                        color={categoryColor(category?.color)}
                        name={entry.description}
                      />
                    </Td>
                    <Td className="text-ink-2">{sourceName(entry)}</Td>
                    <Td numeric>
                      <Amount
                        cents={entry.kind === 'receita' ? entry.cents : -entry.cents}
                        variant="flow"
                      />
                    </Td>
                  </Row>
                );
              })}
            </tbody>
          </FinTable>
          <footer className="px-4 py-3">
            <Link to={financeRoutes.entries('situacao=prevista')} className={LINK}>
              Ver os {planned.length} previstos
            </Link>
          </footer>
        </>
      )}
    </Panel>
  );
};

/* -------------------------------------------------------------------------- */
/* FVG-005 · Faturas abertas                                                  */

export const FaturasAbertasPanel = ({
  data,
  today,
}: {
  readonly data: FinanceData;
  readonly today: IsoDate;
}): React.ReactElement => {
  const summaries = useMemo(
    () => data.cards.map((card) => cardSummary(data, card, today)),
    [data, today],
  );
  const navigate = useNavigate();
  const owing = summaries.filter((item) => item.usedCents > 0);
  const closes = owing.map((item) => item.invoice.closing).sort(compareDates)[0];
  const due = owing.map((item) => item.invoice.due).sort(compareDates)[0];

  return (
    <Panel
      title="Faturas abertas"
      action={<span className="text-xs text-ink-3">% do limite usado</span>}
    >
      {summaries.length === 0 ? (
        <EmptyPanel message="Nenhum cartão cadastrado." />
      ) : (
        <>
          <FinTable caption="Faturas abertas">
            <THead>
              <Th>Cartão</Th>
              <Th align="right">Fatura</Th>
              <Th align="right">Limite</Th>
            </THead>
            <tbody>
              {summaries.map((item) => {
                const tone = limitTone(item.usedPercent);
                return (
                  <Row
                    key={item.card.id}
                    label={item.card.name}
                    onClick={() => void navigate(financeRoutes.card(item.card.id))}
                  >
                    <Td>
                      <span className="font-medium">{item.card.name}</span>{' '}
                      <span className="tabular text-xs text-ink-3">
                        •••• {item.card.last4}
                      </span>
                    </Td>
                    <Td numeric>
                      <Amount cents={item.usedCents} />
                    </Td>
                    <Td numeric>
                      <span className="inline-flex items-center justify-end gap-2.5">
                        <span className="relative h-1 w-16 overflow-hidden rounded-full bg-line">
                          <span
                            data-tone={tone}
                            className={cn(
                              'absolute inset-y-0 left-0 rounded-full',
                              tone === 'ok'
                                ? 'bg-positive'
                                : tone === 'warn'
                                  ? 'bg-attention'
                                  : 'bg-negative',
                            )}
                            style={{ width: `${Math.min(100, item.usedPercent)}%` }}
                          />
                        </span>
                        <span className="tabular w-12 text-right text-[0.8125rem]">
                          {formatPercentValue(item.usedPercent)}
                        </span>
                      </span>
                    </Td>
                  </Row>
                );
              })}
            </tbody>
          </FinTable>
          <footer className="flex items-baseline justify-between gap-3 border-t border-line px-4 py-3 text-xs text-ink-3">
            <span>
              {closes === undefined || due === undefined
                ? 'nenhuma fatura a pagar'
                : `fecham ${formatDay(closes, today)} · vencem ${formatDay(due, today)}`}
            </span>
            <span className="tabular text-[0.8125rem] font-semibold text-ink">
              <Amount cents={openInvoicesTotal(summaries)} />
            </span>
          </footer>
        </>
      )}
    </Panel>
  );
};

/* -------------------------------------------------------------------------- */
/* FVG-006 · Contas                                                           */

export const ContasPanel = ({
  data,
  today,
}: {
  readonly data: FinanceData;
  readonly today: IsoDate;
}): React.ReactElement => {
  const navigate = useNavigate();
  const overview = useMemo(
    () =>
      accountsOverview(
        data,
        { from: startOfMonth(today), to: endOfMonth(today) },
        today,
        false,
      ),
    [data, today],
  );

  return (
    <Panel
      title="Contas"
      action={<span className="text-xs text-ink-3">saldo de hoje</span>}
    >
      {overview.accounts.length === 0 ? (
        <EmptyPanel message="Nenhuma conta cadastrada." />
      ) : (
        <FinTable caption="Contas">
          <THead>
            <Th>Conta</Th>
            <Th align="right">Saldo</Th>
          </THead>
          <tbody>
            {overview.accounts.map((row) => (
              <Row
                key={row.account.id}
                label={row.account.name}
                onClick={() => void navigate(financeRoutes.account(row.account.id))}
              >
                <Td className="font-medium">{row.account.name}</Td>
                <Td numeric>
                  <Amount cents={row.balance} />
                </Td>
              </Row>
            ))}
            <tr className="border-t border-line bg-panel-2 font-semibold">
              <td className="px-3 py-[var(--row-pad)]">
                <Link
                  to={financeRoutes.accounts()}
                  className="cursor-pointer hover:underline"
                >
                  Total em contas
                </Link>
              </td>
              <td className="tabular px-3 py-[var(--row-pad)] text-right">
                <Amount cents={overview.totalBalance} />
              </td>
            </tr>
          </tbody>
        </FinTable>
      )}
    </Panel>
  );
};
