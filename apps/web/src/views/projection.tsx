import type { PortfolioResource } from '@patrimonio/contracts';
import { useMemo, useRef, useState } from 'react';

import { Money } from '../components/number.js';
import { Button, Panel, Segmented } from '../components/primitives.js';
import { useElementWidth } from '../components/use_element_width.js';
import { today as financeToday } from '../finance/lib/clock.js';
import { formatMonth } from '../finance/lib/format.js';
import { centsToDecimal } from '../finance/lib/money.js';
import {
  formatRate,
  monthAfter,
  parseRate,
  projectInvestments,
  ruleOfDraft,
  validateRule,
} from '../lib/investment_plan.js';
import type {
  InvestmentPlan,
  PlanMonth,
  PlanRule,
  RuleDraft,
} from '../lib/investment_plan.js';
import { newRuleId, usePlan } from '../lib/investment_plan_store.js';
import { Input, MoneyInput, PercentInput } from './entry/fields.js';

/**
 * Projeção de Investimentos: quanto cada carteira vale daqui para a frente se o
 * plano de aportes for seguido.
 *
 * O plano tem um aporte mensal total, dividido entre as carteiras em %, aportes
 * avulsos de valor fixo e a rentabilidade esperada de cada carteira. Nada vem de
 * Finanças: são áreas separadas. A tela mostra todas as carteiras juntas ou uma
 * de cada vez; para a carteira escolhida, o objetivo dela (de Objetivos) entra
 * como linha de meta e como o mês em que o plano chega lá. O plano é uma hipótese
 * guardada neste navegador; nada aqui lança aporte nem altera um objetivo.
 */

const COLORS = [
  'var(--color-accent)',
  'var(--color-cat-green)',
  'var(--color-cat-orange)',
  'var(--color-cat-rose)',
  'var(--color-cat-teal)',
  'var(--color-cat-violet)',
] as const;

const HORIZONS = [
  { value: '12', label: '12 meses' },
  { value: '24', label: '2 anos' },
  { value: '36', label: '3 anos' },
  { value: '60', label: '5 anos' },
] as const;
type Horizon = (typeof HORIZONS)[number]['value'];

const toCents = (decimal: string | undefined): number =>
  decimal === undefined ? 0 : Math.round(Number(decimal) * 100);

const monthLabel = (key: string): string => formatMonth(`${key}-01`);

type Start = { readonly id: string; readonly name: string; readonly cents: number };

export type ProjectionScreenProps = {
  readonly portfolios: readonly PortfolioResource[];
  /** A carteira escolhida no seletor do topo; `null` é "Todas as carteiras". */
  readonly portfolioId: string | null;
  /** O valor de cada carteira no último fechamento, por identificador. */
  readonly values: Readonly<Record<string, string>>;
};

export const ProjectionScreen = ({
  portfolios,
  portfolioId,
  values,
}: ProjectionScreenProps): React.ReactElement => {
  const { plan, set } = usePlan();
  const [horizon, setHorizon] = useState<Horizon>('24');
  const months = Number(horizon);
  const firstMonth = monthAfter(financeToday().slice(0, 7), 1);

  const allStarts = useMemo<readonly Start[]>(
    () =>
      portfolios.map((portfolio) => ({
        id: portfolio.id,
        name: portfolio.name,
        cents: toCents(values[portfolio.id]),
      })),
    [portfolios, values],
  );
  const rows = useMemo(
    () => projectInvestments(allStarts, plan, firstMonth, months),
    [allStarts, plan, firstMonth, months],
  );

  const focus = allStarts.find((start) => start.id === portfolioId) ?? null;
  const starts = focus === null ? allStarts : [focus];

  const startTotal = starts.reduce((acc, start) => acc + start.cents, 0);
  const endOf = (row: PlanMonth): number =>
    starts.reduce((acc, start) => acc + (row.end[start.id] ?? 0), 0);
  const aporteOf = (row: PlanMonth): number =>
    starts.reduce((acc, start) => acc + (row.aporte[start.id] ?? 0), 0);
  const rendOf = (row: PlanMonth): number =>
    starts.reduce((acc, start) => acc + (row.rendimento[start.id] ?? 0), 0);
  const last = rows[rows.length - 1];
  const endTotal = last === undefined ? startTotal : endOf(last);
  const totalAporte = rows.reduce((acc, row) => acc + aporteOf(row), 0);
  const totalRendimento = rows.reduce((acc, row) => acc + rendOf(row), 0);
  const weight =
    focus === null || last === undefined
      ? null
      : {
          today: allStarts.reduce((a, s) => a + s.cents, 0),
          end: rows[rows.length - 1]?.totalEnd ?? 0,
        };

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[1.375rem] font-semibold">Projeção</h1>
          <p className="text-[0.8125rem] text-ink-2">
            Quanto{' '}
            {focus === null ? 'as carteiras valem' : `a carteira ${focus.name} vale`} se o
            plano de aportes for seguido, a partir de {monthLabel(firstMonth)}.
          </p>
        </div>
        <Segmented
          label="Até quando projetar"
          options={HORIZONS}
          value={horizon}
          onChange={setHorizon}
        />
      </header>

      <Panel title="Resultado do plano">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 px-5 py-4 text-sm lg:grid-cols-4">
          <Stat
            label={focus === null ? 'Nas carteiras hoje' : 'Na carteira hoje'}
            value={startTotal}
            sub={
              focus === null
                ? `${starts.length} carteiras`
                : weight === null || weight.today === 0
                  ? ''
                  : `${((startTotal / weight.today) * 100).toFixed(1).replace('.', ',')}% do total`
            }
          />
          <Stat
            label={`Em ${last === undefined ? '—' : monthLabel(last.key)}`}
            value={endTotal}
            sub={
              <>
                {last === undefined ? null : (
                  <Money value={centsToDecimal(endTotal - startTotal)} tone="signed" />
                )}{' '}
                no período
              </>
            }
          />
          <Stat
            label="Aportes no período"
            value={totalAporte}
            sub={
              <>
                média de{' '}
                <Money
                  value={centsToDecimal(Math.round(totalAporte / Math.max(1, months)))}
                  decimals={0}
                />{' '}
                por mês
              </>
            }
          />
          <Stat
            label="Rendimento estimado"
            value={totalRendimento}
            sub={
              totalAporte + totalRendimento === 0
                ? 'com a rentabilidade esperada'
                : `${Math.round((totalRendimento / (totalAporte + totalRendimento)) * 100)}% do crescimento`
            }
          />
        </dl>
      </Panel>

      <Panel
        title={focus === null ? 'Evolução das carteiras' : `Evolução de ${focus.name}`}
        hint={
          focus === null
            ? 'fim de cada mês'
            : 'valor de hoje, aportes e rendimento acumulados'
        }
      >
        <Chart
          starts={starts}
          rows={rows}
          firstMonth={firstMonth}
          stacked={focus !== null}
        />
      </Panel>

      <Panel title="Rentabilidade esperada" hint="ao ano, por carteira">
        <RatesTable
          starts={focus === null ? allStarts : [focus]}
          plan={plan}
          onChange={set}
        />
      </Panel>

      <Panel title="Plano de aportes" hint="valor fixo por mês, por carteira">
        <PlanEditor
          portfolios={portfolios}
          plan={plan}
          onChange={set}
          firstMonth={firstMonth}
          focus={focus?.id ?? null}
          starts={allStarts}
          rows={rows}
        />
      </Panel>

      <Panel title="Mês a mês">
        {focus === null ? (
          <MonthTable starts={allStarts} rows={rows} />
        ) : (
          <FocusTable start={focus} rows={rows} />
        )}
      </Panel>
    </div>
  );
};

const Stat = ({
  label,
  value,
  sub,
}: {
  readonly label: string;
  readonly value: number;
  readonly sub: React.ReactNode;
}): React.ReactElement => (
  <div>
    <dt className="tabular text-label tracking-[0.08em] text-ink-3 uppercase">{label}</dt>
    <dd className="tabular mt-1 text-lg font-semibold">
      <Money value={centsToDecimal(value)} decimals={0} />
    </dd>
    <dd className="text-xs text-ink-3">{sub}</dd>
  </div>
);

/* -------------------------------------------------------------------------- */
/* Gráfico                                                                     */

const HEIGHT = 240;
const MARGIN = { top: 14, right: 16, bottom: 26, left: 64 } as const;

const compact = (cents: number): string =>
  cents >= 100_000_000
    ? `R$ ${(cents / 100_000_000).toFixed(1).replace('.', ',')} mi`
    : `R$ ${Math.round(cents / 100_000)} mil`;

type Layer = {
  readonly key: string;
  readonly label: string;
  readonly color: string;
  /** Em linhas, o valor da série; empilhado, a parte da camada. */
  readonly values: readonly number[];
  readonly strong?: boolean;
};

const Chart = ({
  starts,
  rows,
  firstMonth,
  stacked,
}: {
  readonly starts: readonly Start[];
  readonly rows: readonly PlanMonth[];
  readonly firstMonth: string;
  readonly stacked: boolean;
}): React.ReactElement => {
  const container = useRef<HTMLDivElement>(null);
  const width = useElementWidth(container, 720);
  const [hover, setHover] = useState<number | null>(null);

  const sumOf = (
    pick: (row: PlanMonth) => Readonly<Record<string, number>>,
    row: PlanMonth,
  ) => starts.reduce((acc, start) => acc + (pick(row)[start.id] ?? 0), 0);
  const startTotal = starts.reduce((acc, start) => acc + start.cents, 0);

  const layers: readonly Layer[] = (() => {
    if (!stacked) {
      return [
        ...starts.map((start, index) => ({
          key: start.id,
          label: start.name,
          color: COLORS[index % COLORS.length] ?? COLORS[0],
          values: [start.cents, ...rows.map((row) => row.end[start.id] ?? 0)],
        })),
        {
          key: 'total',
          label: 'Total',
          color: 'var(--color-ink)',
          strong: true,
          values: [startTotal, ...rows.map((row) => sumOf((r) => r.end, row))],
        },
      ];
    }
    let aporte = 0;
    let rend = 0;
    const aportes = [0];
    const rends = [0];
    for (const row of rows) {
      aporte += sumOf((r) => r.aporte, row);
      rend += sumOf((r) => r.rendimento, row);
      aportes.push(aporte);
      rends.push(rend);
    }
    return [
      {
        key: 'inicial',
        label: 'Valor de hoje',
        color: 'var(--color-cat-teal)',
        values: aportes.map(() => startTotal),
      },
      { key: 'aportes', label: 'Aporte', color: 'var(--color-accent)', values: aportes },
      {
        key: 'rendimento',
        label: 'Rendimento',
        color: 'var(--color-cat-green)',
        values: rends,
      },
    ];
  })();

  const labels = [monthAfter(firstMonth, -1), ...rows.map((row) => row.key)];
  const count = labels.length;
  const totals = labels.map((_, index) =>
    stacked
      ? layers.reduce((acc, layer) => acc + (layer.values[index] ?? 0), 0)
      : (layers[layers.length - 1]?.values[index] ?? 0),
  );
  const peak = Math.max(1, ...totals);
  const max = peak * 1.06;

  const at = hover ?? count - 1;
  const legend = [
    {
      key: 'total',
      label: 'Total',
      color: 'var(--color-ink)',
      value: totals[at] ?? 0,
    },
    ...layers
      .filter((layer) => layer.key !== 'total')
      .map((layer) => ({
        key: layer.key,
        label: layer.label,
        color: layer.color,
        value: layer.values[at] ?? 0,
      })),
  ];

  const svgWidth = Math.max(1, width - 40);
  const plotWidth = Math.max(1, svgWidth - MARGIN.left - MARGIN.right);
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const x = (index: number): number => (index / Math.max(1, count - 1)) * plotWidth;
  const y = (cents: number): number => plotHeight - (cents / max) * plotHeight;
  const ticks = [0, max / 2, max].map((value) => Math.round(value / 100_000) * 100_000);
  const step = Math.max(1, Math.ceil(count / 8));

  const areas = stacked
    ? layers.map((layer, li) => {
        const below = (index: number): number =>
          layers.slice(0, li).reduce((acc, l) => acc + (l.values[index] ?? 0), 0);
        const top = labels.map(
          (_, index) =>
            `${x(index).toFixed(1)},${y(below(index) + (layer.values[index] ?? 0)).toFixed(1)}`,
        );
        const bottom = labels
          .map((_, index) => `${x(index).toFixed(1)},${y(below(index)).toFixed(1)}`)
          .reverse();
        return { layer, points: [...top, ...bottom].join(' ') };
      })
    : [];

  return (
    <div ref={container} className="relative px-5 pt-4 pb-3">
      <svg
        role="img"
        aria-label={`Evolução projetada de ${monthLabel(labels[0] ?? firstMonth)} a ${monthLabel(labels[count - 1] ?? firstMonth)}`}
        viewBox={`0 0 ${svgWidth} ${HEIGHT}`}
        className="block w-full overflow-visible"
        style={{ height: HEIGHT }}
      >
        <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
          {ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={0}
                x2={plotWidth}
                y1={y(tick)}
                y2={y(tick)}
                className="stroke-line-2"
                strokeDasharray={tick === 0 ? undefined : '2 4'}
              />
              <text
                x={-8}
                y={y(tick) + 4}
                textAnchor="end"
                className="tabular fill-ink-3 text-label"
              >
                {compact(tick)}
              </text>
            </g>
          ))}
          {stacked
            ? areas.map(({ layer, points }) => (
                <polygon
                  key={layer.key}
                  data-layer={layer.key}
                  points={points}
                  style={{ fill: layer.color, fillOpacity: 0.55, stroke: layer.color }}
                  strokeWidth={1}
                />
              ))
            : layers.map((line) => (
                <path
                  key={line.key}
                  data-line={line.key}
                  d={line.values
                    .map(
                      (value, index) =>
                        `${index === 0 ? 'M' : 'L'}${x(index).toFixed(1)},${y(value).toFixed(1)}`,
                    )
                    .join(' ')}
                  fill="none"
                  strokeWidth={line.strong === true ? 2.25 : 1.75}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  style={{ stroke: line.color }}
                />
              ))}
          {labels.map((key, index) =>
            index % step === 0 || index === count - 1 ? (
              <text
                key={key}
                x={x(index)}
                y={plotHeight + 18}
                textAnchor={
                  index === 0 ? 'start' : index === count - 1 ? 'end' : 'middle'
                }
                className="tabular fill-ink-3 text-label"
              >
                {index === 0 ? 'hoje' : monthLabel(key)}
              </text>
            ) : null,
          )}
          {hover === null ? null : (
            <line
              pointerEvents="none"
              x1={x(hover)}
              x2={x(hover)}
              y1={0}
              y2={plotHeight}
              className="stroke-line-strong"
            />
          )}
          <rect
            data-testid="projection-hit"
            x={0}
            y={0}
            width={plotWidth}
            height={plotHeight}
            fill="transparent"
            onMouseMove={(event) => {
              const box = event.currentTarget.getBoundingClientRect();
              const ratio = box.width === 0 ? 0 : (event.clientX - box.left) / box.width;
              setHover(Math.max(0, Math.min(count - 1, Math.round(ratio * (count - 1)))));
            }}
            onMouseLeave={() => setHover(null)}
          />
        </g>
      </svg>
      <ul
        aria-label="Legenda"
        className="tabular mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[0.8125rem]"
      >
        {legend.map((item) => (
          <li key={item.key} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="inline-block size-2 rounded-xs"
              style={{ backgroundColor: item.color }}
            />
            <span className="text-ink-2">{item.label}</span>
          </li>
        ))}
      </ul>
      {hover === null ? null : (
        <div
          role="tooltip"
          className="tabular pointer-events-none absolute top-4 rounded-control border border-line-2 bg-panel px-2.5 py-1.5 text-xs shadow-panel"
          style={{
            left: `min(max(${MARGIN.left + x(hover) + 28}px, 8px), calc(100% - 13rem))`,
          }}
        >
          <div className="text-ink-3">
            {hover === 0 ? 'hoje' : monthLabel(labels[hover] ?? firstMonth)}
          </div>
          {legend.map((item) => (
            <div key={item.key} className="flex items-center justify-between gap-4">
              <span
                style={{ color: item.color }}
                className={item.key === 'total' ? 'font-semibold' : ''}
              >
                {item.label}
              </span>
              <Money value={centsToDecimal(item.value)} decimals={0} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* Tabelas mês a mês                                                           */

const MonthTable = ({
  starts,
  rows,
}: {
  readonly starts: readonly { readonly id: string; readonly name: string }[];
  readonly rows: readonly PlanMonth[];
}): React.ReactElement => (
  <div className="overflow-x-auto">
    <table className="w-full border-collapse text-cell whitespace-nowrap">
      <caption className="sr-only">Projeção mês a mês</caption>
      <thead>
        <tr className="border-b border-line">
          <Th>Mês</Th>
          {starts.map((start) => (
            <Th key={start.id} right>
              Aporte · {start.name}
            </Th>
          ))}
          <Th right>Rendimento</Th>
          {starts.map((start) => (
            <Th key={start.id} right>
              {start.name}
            </Th>
          ))}
          <Th right>Total</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key} className="border-b border-line last:border-b-0">
            <td className="px-3 py-[var(--row-pad)] font-medium">
              {monthLabel(row.key)}
            </td>
            {starts.map((start) => (
              <Cell key={start.id} cents={row.aporte[start.id] ?? 0} />
            ))}
            <Cell cents={row.totalRendimento} />
            {starts.map((start) => (
              <Cell key={start.id} cents={row.end[start.id] ?? 0} />
            ))}
            <Cell cents={row.totalEnd} strong />
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const FocusTable = ({
  start,
  rows,
}: {
  readonly start: Start;
  readonly rows: readonly PlanMonth[];
}): React.ReactElement => {
  let accumulated = 0;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-cell whitespace-nowrap">
        <caption className="sr-only">Projeção mês a mês</caption>
        <thead>
          <tr className="border-b border-line">
            <Th>Mês</Th>
            <Th right>Aporte</Th>
            <Th right>Aporte acumulado</Th>
            <Th right>Rendimento</Th>
            <Th right>{start.name}</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            accumulated += row.aporte[start.id] ?? 0;
            return (
              <tr key={row.key} className="border-b border-line last:border-b-0">
                <td className="px-3 py-[var(--row-pad)] font-medium">
                  {monthLabel(row.key)}
                </td>
                <Cell cents={row.aporte[start.id] ?? 0} />
                <Cell cents={accumulated} />
                <Cell cents={row.rendimento[start.id] ?? 0} />
                <Cell cents={row.end[start.id] ?? 0} strong />
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

const Th = ({
  children,
  right = false,
}: {
  readonly children: React.ReactNode;
  readonly right?: boolean;
}): React.ReactElement => (
  <th
    scope="col"
    className={`tabular px-3 py-2.5 text-label font-normal tracking-[0.08em] text-ink-3 uppercase ${right ? 'text-right' : 'text-left'}`}
  >
    {children}
  </th>
);

const Cell = ({
  cents,
  strong = false,
}: {
  readonly cents: number;
  readonly strong?: boolean;
}): React.ReactElement => (
  <td
    className={`tabular px-3 py-[var(--row-pad)] text-right ${strong ? 'font-semibold' : ''}`}
  >
    <Money value={centsToDecimal(cents)} decimals={0} />
  </td>
);

/* -------------------------------------------------------------------------- */
/* Plano                                                                       */

const EMPTY_DRAFT = (firstMonth: string, portfolioId: string): RuleDraft => ({
  portfolioId,
  value: '',
  from: firstMonth,
  until: '',
});

const moneyText = (cents: number): string =>
  (cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 });

/** A rentabilidade de uma carteira: guarda o texto enquanto digita e grava o que é válido. */
const RateInput = ({
  name,
  bp,
  onCommit,
}: {
  readonly name: string;
  readonly bp: number;
  readonly onCommit: (bp: number) => void;
}): React.ReactElement => {
  const [text, setText] = useState<string | null>(null);
  return (
    <PercentInput
      aria-label={`Rentabilidade esperada · ${name}`}
      placeholder="0"
      invalid={text !== null && parseRate(text) === null}
      value={text ?? (bp === 0 ? '' : formatRate(bp))}
      onChange={(event) => {
        setText(event.target.value);
        const parsed = parseRate(event.target.value);
        if (parsed !== null) onCommit(parsed);
      }}
      onBlur={() => setText(null)}
    />
  );
};

const Total = ({ cents }: { readonly cents: number }): React.ReactElement => (
  <Money value={centsToDecimal(cents)} decimals={0} />
);

const GRID = 'md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_12rem]';

/** A rentabilidade esperada de cada carteira, separada do plano de aportes. */
const RatesTable = ({
  starts,
  plan,
  onChange,
}: {
  readonly starts: readonly Start[];
  readonly plan: InvestmentPlan;
  readonly onChange: (next: InvestmentPlan) => void;
}): React.ReactElement => (
  <div className="overflow-x-auto">
    <table className="w-full border-collapse text-cell whitespace-nowrap">
      <caption className="sr-only">Rentabilidade esperada por carteira</caption>
      <thead>
        <tr className="border-b border-line">
          <Th>Carteira</Th>
          <Th right>Hoje</Th>
          <Th right>Rentabilidade (% ao ano)</Th>
        </tr>
      </thead>
      <tbody>
        {starts.map((start) => (
          <tr key={start.id} className="border-b border-line last:border-b-0">
            <td className="px-3 py-[var(--row-pad)] font-medium">{start.name}</td>
            <Cell cents={start.cents} />
            <td className="px-3 py-1.5 text-right">
              <span className="inline-block w-28">
                <RateInput
                  name={start.name}
                  bp={plan.rates[start.id] ?? 0}
                  onCommit={(bp) =>
                    onChange({ ...plan, rates: { ...plan.rates, [start.id]: bp } })
                  }
                />
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

/**
 * Uma regra já criada, editável no lugar: cada campo grava assim que o conjunto
 * fica válido; enquanto não fica, o campo mostra o que a pessoa digitou.
 */
const RuleRow = ({
  rule,
  portfolios,
  name,
  onChange,
  onRemove,
}: {
  readonly rule: PlanRule;
  readonly portfolios: readonly PortfolioResource[];
  readonly name: string;
  readonly onChange: (next: PlanRule) => void;
  readonly onRemove: () => void;
}): React.ReactElement => {
  const [draft, setDraft] = useState<RuleDraft>(() => ({
    portfolioId: rule.portfolioId,
    value: moneyText(rule.cents),
    from: rule.from,
    until: rule.until ?? '',
  }));
  const ids = portfolios.map((p) => p.id);
  const errors = validateRule(draft, ids);
  const edit = (patch: Partial<RuleDraft>): void => {
    const next = { ...draft, ...patch };
    setDraft(next);
    if (Object.keys(validateRule(next, ids)).length === 0)
      onChange(ruleOfDraft(next, rule.id));
  };

  return (
    <li className={`grid items-center gap-2 px-3 py-1.5 ${GRID}`}>
      <MoneyInput
        aria-label={`Valor por mês da regra de ${name}`}
        invalid={errors['value'] !== undefined}
        value={draft.value}
        onChange={(e) => edit({ value: e.target.value })}
      />
      <Input
        aria-label={`A partir de, regra de ${name}`}
        type="month"
        invalid={errors['from'] !== undefined}
        value={draft.from}
        onChange={(e) => edit({ from: e.target.value })}
      />
      <Input
        aria-label={`Até, regra de ${name}`}
        type="month"
        invalid={errors['until'] !== undefined}
        value={draft.until}
        onChange={(e) => edit({ until: e.target.value })}
      />
      <Button
        className="w-full"
        variant="destructive"
        onClick={onRemove}
        aria-label={`Remover regra de ${name}`}
      >
        Remover
      </Button>
    </li>
  );
};

/** A linha em branco que abre ao pedir uma regra nova, com os mesmos campos da regra. */
const NewRuleRow = ({
  portfolioId,
  name,
  portfolios,
  firstMonth,
  onAdd,
  onCancel,
}: {
  readonly portfolioId: string;
  readonly name: string;
  readonly portfolios: readonly PortfolioResource[];
  readonly firstMonth: string;
  readonly onAdd: (rule: PlanRule) => void;
  readonly onCancel: () => void;
}): React.ReactElement => {
  const [draft, setDraft] = useState<RuleDraft>(() =>
    EMPTY_DRAFT(firstMonth, portfolioId),
  );
  const [attempted, setAttempted] = useState(false);
  const errors = validateRule(
    draft,
    portfolios.map((p) => p.id),
  );
  const show = (field: keyof RuleDraft): boolean =>
    attempted && errors[field] !== undefined;

  return (
    <li className="flex flex-col gap-1 py-1.5">
      <div className={`grid items-center gap-2 px-3 ${GRID}`}>
        <MoneyInput
          autoFocus
          aria-label={`Novo valor por mês, ${name}`}
          invalid={show('value')}
          value={draft.value}
          onChange={(e) => setDraft({ ...draft, value: e.target.value })}
        />
        <Input
          aria-label={`Novo início, ${name}`}
          type="month"
          invalid={show('from')}
          value={draft.from}
          onChange={(e) => setDraft({ ...draft, from: e.target.value })}
        />
        <Input
          aria-label={`Novo fim, ${name}`}
          type="month"
          invalid={show('until')}
          value={draft.until}
          onChange={(e) => setDraft({ ...draft, until: e.target.value })}
        />
        <div className="grid grid-cols-2 gap-1.5 whitespace-nowrap">
          <Button
            variant="primary"
            onClick={() => {
              setAttempted(true);
              if (Object.keys(errors).length > 0) return;
              onAdd(ruleOfDraft(draft, newRuleId()));
            }}
          >
            Salvar
          </Button>
          <Button onClick={onCancel}>Cancelar</Button>
        </div>
      </div>
      {attempted && Object.keys(errors).length > 0 ? (
        <p role="alert" className="text-xs text-negative">
          {errors['value'] ?? errors['from'] ?? errors['until']}
        </p>
      ) : null}
    </li>
  );
};

/**
 * O plano, carteira por carteira: cada bloco tem a rentabilidade esperada, o
 * que a carteira recebe por mês e as regras dela, editáveis no lugar. Uma regra
 * nova abre como uma linha em branco dentro do bloco, só ao pedir.
 */
const PlanEditor = ({
  portfolios,
  plan,
  onChange,
  firstMonth,
  focus,
  starts,
  rows,
}: {
  readonly portfolios: readonly PortfolioResource[];
  readonly plan: InvestmentPlan;
  readonly onChange: (next: InvestmentPlan) => void;
  readonly firstMonth: string;
  /** A carteira em foco; `null` mostra o plano inteiro. */
  readonly focus: string | null;
  readonly starts: readonly Start[];
  readonly rows: readonly PlanMonth[];
}): React.ReactElement => {
  const [adding, setAdding] = useState<string | null>(null);
  const shownStarts =
    focus === null ? starts : starts.filter((start) => start.id === focus);
  const perMonth = shownStarts.reduce(
    (acc, start) => acc + (rows[0]?.aporte[start.id] ?? 0),
    0,
  );

  return (
    <div className="flex flex-col">
      <div
        aria-hidden="true"
        className={`hidden gap-2 border-b border-line px-3 py-2 text-label tracking-[0.08em] text-ink-3 uppercase md:grid ${GRID}`}
      >
        <span>Valor por mês</span>
        <span>A partir de</span>
        <span>Até</span>
        <span />
      </div>

      {shownStarts.map((start) => {
        const rules = plan.rules.filter((rule) => rule.portfolioId === start.id);
        const monthly = rows[0]?.aporte[start.id] ?? 0;
        return (
          <section
            key={start.id}
            aria-label={`Plano de ${start.name}`}
            className="border-b border-line last:border-b-0"
          >
            <header
              className={`grid items-center gap-x-2 gap-y-2 bg-panel-2 px-3 py-2.5 ${GRID}`}
            >
              <div className="flex min-w-0 flex-col md:col-span-3">
                <h3 className="text-[0.8125rem] font-semibold">{start.name}</h3>
                <span className="tabular text-xs text-ink-3">
                  hoje <Total cents={start.cents} /> · recebe <Total cents={monthly} />{' '}
                  por mês
                </span>
              </div>

              <Button
                className="w-full"
                aria-label={`Adicionar regra em ${start.name}`}
                onClick={() => setAdding(start.id)}
                disabled={adding === start.id}
              >
                Adicionar regra
              </Button>
            </header>
            {rules.length === 0 && adding !== start.id ? (
              <p className="px-3 py-2 text-[0.8125rem] text-ink-3">
                Nenhuma regra: a carteira só muda pela rentabilidade esperada.
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {rules.map((rule) => (
                  <RuleRow
                    key={rule.id}
                    rule={rule}
                    portfolios={portfolios}
                    name={start.name}
                    onChange={(next) =>
                      onChange({
                        ...plan,
                        rules: plan.rules.map((r) => (r.id === next.id ? next : r)),
                      })
                    }
                    onRemove={() =>
                      onChange({
                        ...plan,
                        rules: plan.rules.filter((r) => r.id !== rule.id),
                      })
                    }
                  />
                ))}
                {adding === start.id ? (
                  <NewRuleRow
                    portfolioId={start.id}
                    name={start.name}
                    portfolios={portfolios}
                    firstMonth={firstMonth}
                    onCancel={() => setAdding(null)}
                    onAdd={(rule) => {
                      onChange({ ...plan, rules: [...plan.rules, rule] });
                      setAdding(null);
                    }}
                  />
                ) : null}
              </ul>
            )}
          </section>
        );
      })}

      <footer className="tabular flex items-center justify-between gap-4 border-t border-line-2 px-3 py-2.5 text-[0.8125rem]">
        <span className="font-medium">
          {focus === null ? 'Total por mês, em todas as carteiras' : 'Total por mês'}
        </span>
        <strong className="font-semibold" data-testid="plan-total">
          <Total cents={perMonth} />
        </strong>
      </footer>
    </div>
  );
};
