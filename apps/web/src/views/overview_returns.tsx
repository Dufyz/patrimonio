import type { PerformanceResource } from '@patrimonio/contracts';
import { normalizeBenchmark } from '@patrimonio/domain';
import type { DateOnly } from '@patrimonio/domain';
import { useRef, useState } from 'react';

import { Chip } from '../components/primitives.js';
import { Percent } from '../components/number.js';
import { useDismiss } from '../components/use_dismiss.js';
import { formatDate, percentAsRatio } from '../lib/overview.js';
import {
  PORTFOLIO_COLOR,
  windowLabel,
  addBenchmark,
  availableToAdd,
  benchmarkColor,
  extraBenchmarks,
  removeBenchmark,
} from '../lib/performance.js';
import { colorForSeries } from '../lib/tokens.js';

/**
 * O retorno da carteira dentro da Visão geral: o gráfico acumulado contra os
 * benchmarks e o método dos números. É o que a antiga tela de Desempenho
 * mostrava, agora na mesma tela do patrimônio, mas em gráfico próprio: aporte
 * em reais e retorno em percentual respondem perguntas diferentes.
 *
 * Nada aqui faz conta. Retorno e diferença em pontos chegam prontos; a tela
 * escolhe cor, casa decimal e ordem.
 */

/* -------------------------------------------------------------------------- */
/* Retorno acumulado × benchmarks                                              */

const BenchmarkPicker = ({
  options,
  onPick,
}: {
  readonly options: readonly { readonly id: string; readonly name: string }[];
  readonly onPick: (id: string) => void;
}): React.ReactElement | null => {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  useDismiss(container, open, () => setOpen(false));

  const [draft, setDraft] = useState('');
  const typed = normalizeBenchmark(draft);

  const add = (id: string): void => {
    onPick(id);
    setDraft('');
    setOpen(false);
  };

  return (
    <div ref={container} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex h-control cursor-pointer items-center gap-2 rounded-full border border-dashed border-line-strong px-3 text-[0.8125rem] text-ink-2 hover:bg-panel-2"
        onClick={() => setOpen((value) => !value)}
      >
        <span aria-hidden="true">+</span> Benchmark
      </button>
      {open ? (
        <ul
          role="menu"
          className="absolute top-full left-0 z-20 mt-1 min-w-48 rounded-panel border border-line bg-panel p-1 shadow-lg"
        >
          {options.map((option) => (
            <li key={option.id} role="none">
              <button
                type="button"
                role="menuitem"
                className="w-full cursor-pointer rounded-control px-3 py-1.5 text-left text-[0.8125rem] hover:bg-panel-2"
                onClick={() => add(option.id)}
              >
                {option.name}
              </button>
            </li>
          ))}
          <li role="none" className="mt-1 border-t border-line px-2 pt-2 pb-1">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (typed !== null) add(typed);
              }}
            >
              <input
                type="text"
                aria-label="Outro benchmark"
                placeholder="IPCA+6 ou 110%CDI"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                className="h-control w-full rounded-control border border-line bg-panel px-2 text-[0.8125rem]"
              />
              {draft !== '' && typed === null ? (
                <p role="alert" className="mt-1 text-[0.75rem] text-ink-3">
                  Use CDI, IPCA+6 ou 110%CDI.
                </p>
              ) : null}
            </form>
          </li>
        </ul>
      ) : null}
    </div>
  );
};

const LineSwatch = ({
  color,
  dashed = false,
}: {
  readonly color: string;
  readonly dashed?: boolean;
}): React.ReactElement => (
  <span
    aria-hidden="true"
    className="inline-block h-0 w-4 shrink-0 border-t-2"
    style={{ borderColor: color, borderStyle: dashed ? 'dashed' : 'solid' }}
  />
);

/** As janelas que a prancha mostra, na ordem em que a leitura vai do curto ao longo. */
const WINDOWS = ['month', 'ytd', '12m', 'inception'] as const;

type Bar = {
  readonly id: string;
  readonly label: string;
  readonly color: string;
  readonly value: string | null;
};

const BarRow = ({
  bar,
  scale,
}: {
  readonly bar: Bar;
  /** O maior módulo entre todas as barras: o comprimento é comparável entre janelas. */
  readonly scale: number;
}): React.ReactElement => {
  const ratio = percentAsRatio(bar.value);
  const magnitude = bar.value === null ? 0 : Math.abs(Number(bar.value));
  const width = scale === 0 ? 0 : Math.min(100, (magnitude / scale) * 100);

  return (
    <li className="flex items-center gap-3 text-[0.8125rem]">
      <span className="w-40 shrink-0 truncate" title={bar.label}>
        {bar.label}
      </span>
      <span
        className="relative h-2 min-w-0 flex-1 rounded-xs bg-panel-2"
        aria-hidden="true"
      >
        <span
          className="absolute inset-y-0 left-0 rounded-xs"
          style={{
            width: `${width}%`,
            backgroundColor:
              bar.value !== null && Number(bar.value) < 0
                ? 'var(--color-negative)'
                : bar.color,
          }}
        />
      </span>
      <span className="w-20 shrink-0 text-right">
        <Percent value={ratio} decimals={2} signed tone="signed" />
      </span>
    </li>
  );
};

/**
 * IVG-005 · Retorno × benchmarks em barras: a carteira (ou todas) ao lado do
 * benchmark, por janela. Em Todas as carteiras entram também as carteiras, cada
 * uma pela cota dela. O benchmark é escolhido por etiquetas removíveis.
 */
export const ReturnsBars = ({
  data,
  extraIds,
  onExtraIdsChange,
}: {
  readonly data: PerformanceResource;
  readonly extraIds: readonly string[];
  readonly onExtraIdsChange: (ids: readonly string[]) => void;
}): React.ReactElement => {
  const { benchmarks, scope, windows, breakdown } = data;
  const primary = benchmarks.selected.find((item) => item.id === benchmarks.primary_id);
  const extras = extraBenchmarks(benchmarks.selected, benchmarks.primary_id);
  const consolidated = scope.portfolio_id === null;
  const context = { referenceDate: data.reference_date, inception: scope.inception };

  const groups = WINDOWS.map((key) => {
    const column = windows.columns.findIndex((item) => item.key === key);
    const breakdownColumn = breakdown.columns.findIndex((item) => item.key === key);

    const bars: Bar[] = windows.rows
      .filter((row) => row.kind !== 'difference')
      .map((row) => ({
        id: `${row.kind}:${row.benchmark ?? ''}`,
        label: row.name,
        color:
          row.kind === 'portfolio'
            ? PORTFOLIO_COLOR
            : benchmarkColor(
                Math.max(
                  0,
                  benchmarks.selected.findIndex((item) => item.id === row.benchmark),
                ),
              ),
        value: column < 0 ? null : (row.values[column] ?? null),
      }));

    if (consolidated) {
      breakdown.portfolios.forEach((portfolio, index) =>
        bars.push({
          id: `carteira:${portfolio.portfolio_id}`,
          label: portfolio.name,
          color: colorForSeries(index),
          value:
            breakdownColumn < 0 ? null : (portfolio.returns[breakdownColumn] ?? null),
        }),
      );
    }

    return { key, bars };
  });

  const scale = Math.max(
    0,
    ...groups.flatMap((group) =>
      group.bars.map((bar) => (bar.value === null ? 0 : Math.abs(Number(bar.value)))),
    ),
  );

  const gapIds = new Set(benchmarks.gaps.map((gap) => gap.id));
  const missing = benchmarks.selected.filter(
    (item) =>
      !gapIds.has(item.id) && !windows.rows.some((row) => row.benchmark === item.id),
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Chip selected>
          <LineSwatch color={PORTFOLIO_COLOR} />
          {scope.name}
        </Chip>
        {primary === undefined ? null : (
          <span className="text-[0.75rem] text-ink-3">
            benchmark principal: {primary.name}
          </span>
        )}
        {extras.map((item) => (
          <Chip
            key={item.id}
            onRemove={() => onExtraIdsChange(removeBenchmark(extraIds, item.id))}
          >
            <LineSwatch
              color={benchmarkColor(
                benchmarks.selected.findIndex((one) => one.id === item.id),
              )}
            />
            {item.name}
          </Chip>
        ))}
        <BenchmarkPicker
          options={availableToAdd(benchmarks)}
          onPick={(id) => onExtraIdsChange(addBenchmark(extraIds, id))}
        />
      </div>

      <div className="grid grid-cols-1 gap-x-8 gap-y-4 md:grid-cols-2">
        {groups.map((group) => (
          <section
            key={group.key}
            aria-label={`Retorno · ${windowLabel(group.key, context)}`}
          >
            <h3 className="tabular mb-2 text-label font-medium tracking-[0.06em] text-ink-3 uppercase">
              {windowLabel(group.key, context)}
            </h3>
            <ul className="flex flex-col gap-2">
              {group.bars.map((bar) => (
                <BarRow key={bar.id} bar={bar} scale={scale} />
              ))}
            </ul>
          </section>
        ))}
      </div>

      <p className="text-[0.75rem] text-ink-3">
        Retorno pela cota, acumulado até{' '}
        {data.reference_date === null
          ? 'a última consolidação'
          : formatDate(data.reference_date as DateOnly)}{' '}
        · nada anualizado · a janela “Início” parte do primeiro fechamento.
      </p>

      {benchmarks.gaps.length === 0 ? null : (
        <p className="text-[0.75rem] text-attention">
          Falta série para o período:{' '}
          {benchmarks.gaps
            .map((gap) =>
              gap.available_from === null
                ? `${gap.name} (nenhum dado coletado)`
                : `${gap.name} (série a partir de ${formatDate(gap.available_from as DateOnly)})`,
            )
            .join('; ')}
          . O benchmark aparece como traço, e não como uma barra mais curta. Use Atualizar
          agora em Configurações para carregar o histórico.
        </p>
      )}
      {missing.length === 0 ? null : (
        <p className="text-[0.75rem] text-attention">
          Sem dado de índice no período: {missing.map((item) => item.name).join(', ')}.
          Eles aparecem como traço, e não como zero.
        </p>
      )}
    </div>
  );
};
