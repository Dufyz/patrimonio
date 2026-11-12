import type { PerformanceResource } from '@patrimonio/contracts';
import { normalizeBenchmark } from '@patrimonio/domain';
import type { DateOnly } from '@patrimonio/domain';
import { useRef, useState } from 'react';

import { Chip } from '../components/primitives.js';
import { Percent } from '../components/number.js';
import { useDismiss } from '../components/use_dismiss.js';
import { formatDate, percentAsRatio } from '../lib/overview.js';
import {
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

/** A janela da prancha: 12 meses, e a carteira sem 12M cai no ano (YTD). */
const MAIN = '12m';
const FALLBACK = 'ytd';

type Bar = {
  readonly id: string;
  readonly label: string;
  readonly color: string;
  readonly value: string | null;
  /** O rótulo curto da janela quando a linha não usa a principal. */
  readonly window?: string | undefined;
};

const BarRow = ({
  bar,
  scale,
}: {
  readonly bar: Bar;
  /** O maior módulo entre as barras: o comprimento é comparável entre linhas. */
  readonly scale: number;
}): React.ReactElement => {
  const negative = bar.value !== null && Number(bar.value) < 0;
  const magnitude = bar.value === null ? 0 : Math.abs(Number(bar.value));
  const width = scale === 0 ? 0 : Math.min(100, (magnitude / scale) * 100);

  return (
    <li className="grid grid-cols-[minmax(7rem,12rem)_1fr_5.5rem] items-center gap-4 text-[0.8125rem]">
      <span className="truncate text-ink-2" title={bar.label}>
        {bar.label}
        {bar.window === undefined ? null : (
          <span className="text-ink-3"> · {bar.window}</span>
        )}
      </span>
      <span className="relative h-2.5 min-w-0 rounded-full bg-panel-2" aria-hidden="true">
        <span
          className="absolute inset-y-0 left-0 rounded-full"
          style={{
            width: `${width}%`,
            backgroundColor: negative ? 'var(--color-negative)' : bar.color,
          }}
        />
      </span>
      <span className="text-right font-semibold">
        <Percent value={percentAsRatio(bar.value)} decimals={2} signed tone="signed" />
      </span>
    </li>
  );
};

/**
 * IVG-005 · Retorno × benchmarks: uma barra por linha, na janela de 12 meses.
 * A carteira (ou todas) vem primeiro, depois o benchmark; em Todas entram as
 * carteiras, cada uma pela cota dela. Quem não tem 12 meses de história aparece
 * no ano (YTD), dito no rótulo. Os benchmarks escolhidos são etiquetas
 * removíveis, e "+ Benchmark" adiciona outro.
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

  const mainColumn = windows.columns.findIndex((item) => item.key === MAIN);
  const mainBase =
    mainColumn < 0 ? null : (windows.columns[mainColumn]?.base_date ?? null);
  const partial = scope.inception !== null && mainBase === null;

  const bars: Bar[] = windows.rows
    .filter((row) => row.kind !== 'difference')
    .map((row) => ({
      id: `${row.kind}:${row.benchmark ?? ''}`,
      label: row.name,
      color:
        row.kind === 'portfolio'
          ? 'var(--color-ink)'
          : benchmarkColor(
              Math.max(
                0,
                benchmarks.selected.findIndex((item) => item.id === row.benchmark),
              ),
            ),
      value: mainColumn < 0 ? null : (row.values[mainColumn] ?? null),
    }));

  if (consolidated) {
    const main = breakdown.columns.findIndex((item) => item.key === MAIN);
    const fallback = breakdown.columns.findIndex((item) => item.key === FALLBACK);
    breakdown.portfolios.forEach((portfolio, index) => {
      const full = main < 0 ? null : (portfolio.returns[main] ?? null);
      const ytd = fallback < 0 ? null : (portfolio.returns[fallback] ?? null);
      const usesYtd = full === null && ytd !== null;
      bars.push({
        id: `carteira:${portfolio.portfolio_id}`,
        label: portfolio.name,
        color: colorForSeries(index),
        value: usesYtd ? ytd : full,
        window: usesYtd ? 'YTD' : undefined,
      });
    });
  }

  const scale = Math.max(
    0,
    ...bars.map((bar) => (bar.value === null ? 0 : Math.abs(Number(bar.value)))),
  );

  const gapIds = new Set(benchmarks.gaps.map((gap) => gap.id));
  const missing = benchmarks.selected.filter(
    (item) =>
      !gapIds.has(item.id) && !windows.rows.some((row) => row.benchmark === item.id),
  );

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <Chip selected>
          <LineSwatch color="var(--color-ink)" />
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

      <ul className="flex flex-col gap-4 px-4 py-5">
        {bars.map((bar) => (
          <BarRow key={bar.id} bar={bar} scale={scale} />
        ))}
      </ul>

      {partial || benchmarks.gaps.length > 0 || missing.length > 0 ? (
        <div className="flex flex-col gap-1 border-t border-line px-4 py-3 text-xs text-ink-3">
          {partial ? (
            <p>
              Início dos lançamentos em {formatDate(scope.inception as DateOnly).slice(3)}
              : o 12M cobre só parte da janela.
            </p>
          ) : null}
          {benchmarks.gaps.length === 0 ? null : (
            <p className="text-attention">
              Falta série para o período:{' '}
              {benchmarks.gaps
                .map((gap) =>
                  gap.available_from === null
                    ? `${gap.name} (nenhum dado coletado)`
                    : `${gap.name} (série a partir de ${formatDate(gap.available_from as DateOnly)})`,
                )
                .join('; ')}
              . O benchmark aparece como traço, e não como uma barra mais curta. Use
              Atualizar agora em Configurações para carregar o histórico.
            </p>
          )}
          {missing.length === 0 ? null : (
            <p className="text-attention">
              Sem dado de índice no período: {missing.map((item) => item.name).join(', ')}
              . Eles aparecem como traço, e não como zero.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
};
