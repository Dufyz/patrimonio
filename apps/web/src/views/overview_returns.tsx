import type { PerformanceResource } from '@patrimonio/contracts';
import { normalizeBenchmark } from '@patrimonio/domain';
import type { DateOnly } from '@patrimonio/domain';
import { useRef, useState } from 'react';

import { Percent } from '../components/number.js';
import { useDismiss } from '../components/use_dismiss.js';
import { formatDate, percentAsRatio } from '../lib/overview.js';
import {
  addBenchmark,
  availableToAdd,
  benchmarkColor,
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

/**
 * "+ Benchmark" (prancha 05 · F): a lista de índices com caixa de marcação. O
 * principal vem marcado e não desmarca; no máximo quatro linhas no gráfico.
 */
const MAX_LINES = 4;

const BenchmarkPicker = ({
  selected,
  primaryId,
  options,
  onAdd,
  onRemove,
}: {
  readonly selected: readonly { readonly id: string; readonly name: string }[];
  readonly primaryId: string | null;
  readonly options: readonly { readonly id: string; readonly name: string }[];
  readonly onAdd: (id: string) => void;
  readonly onRemove: (id: string) => void;
}): React.ReactElement | null => {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  useDismiss(container, open, () => setOpen(false));

  const [draft, setDraft] = useState('');
  const typed = normalizeBenchmark(draft);
  const full = selected.length >= MAX_LINES;

  const row = (
    item: { readonly id: string; readonly name: string },
    checked: boolean,
  ): React.ReactElement => {
    const primary = item.id === primaryId;
    const disabled = primary || (!checked && full);
    return (
      <li key={item.id} role="none">
        <label
          className={`flex items-start gap-2.5 rounded-control px-3 py-1.5 text-[0.8125rem] ${
            disabled ? 'cursor-default' : 'cursor-pointer hover:bg-panel-2'
          } ${!checked && full ? 'text-ink-3' : ''}`}
        >
          <input
            type="checkbox"
            role="menuitemcheckbox"
            aria-checked={checked}
            checked={checked}
            disabled={disabled}
            className="mt-0.5 size-4 cursor-[inherit] accent-[var(--color-accent)]"
            onChange={() => (checked ? onRemove(item.id) : onAdd(item.id))}
          />
          <span>
            <span className="block">{item.name}</span>
            {primary ? (
              <span className="block text-xs text-ink-3">benchmark principal</span>
            ) : null}
          </span>
        </label>
      </li>
    );
  };

  return (
    <div ref={container} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        className="cursor-pointer text-[0.8125rem] text-accent hover:underline"
        onClick={() => setOpen((value) => !value)}
      >
        + Benchmark →
      </button>
      {open ? (
        <div className="absolute top-full right-0 z-20 mt-1 w-64 rounded-panel border border-line bg-panel p-1 shadow-lg">
          <ul role="menu" aria-label="Benchmarks">
            {selected.map((item) => row(item, true))}
            {options.map((item) => row(item, false))}
          </ul>
          <form
            className="mt-1 border-t border-line px-2 pt-2 pb-1"
            onSubmit={(event) => {
              event.preventDefault();
              if (typed !== null && !full) {
                onAdd(typed);
                setDraft('');
              }
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
          <p className="border-t border-line px-3 pt-2 pb-1.5 text-xs text-ink-3">
            No máximo {MAX_LINES} linhas no gráfico; o benchmark principal não pode ser
            desmarcado.
          </p>
        </div>
      ) : null}
    </div>
  );
};

type Bar = {
  readonly id: string;
  readonly label: string;
  readonly color: string;
  readonly value: string | null;
};

/** O retorno do período: o último ponto da série acumulada, que parte de 0% na base. */
const lastOf = (values: readonly string[]): string | null =>
  values.length < 2 ? null : (values[values.length - 1] ?? null);

/** O retorno de uma carteira no período, pela cota dela. */
export type PortfolioReturn = {
  readonly id: string;
  readonly name: string;
  readonly value: string | null;
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
 * IVG-005 · Retorno × benchmarks: uma barra por linha, no período escolhido no
 * cabeçalho da tela. A carteira (ou todas) vem primeiro, depois os benchmarks;
 * em Todas entram as carteiras, cada uma pela cota dela. Os benchmarks
 * escolhidos são etiquetas removíveis, e "+ Benchmark" adiciona outro.
 */
export const ReturnsBars = ({
  data,
  portfolios,
  compare = false,
  periodFrom,
}: {
  readonly data: PerformanceResource;
  readonly extraIds: readonly string[];
  readonly onExtraIdsChange: (ids: readonly string[]) => void;
  /** Em Todas as carteiras, o retorno de cada uma no mesmo período. */
  readonly portfolios: readonly PortfolioReturn[] | null;
  /** "Comparar" no painel Carteiras: entra uma barra por carteira. */
  readonly compare?: boolean;
  /** O início do período escolhido, para dizer quando ele passa do histórico. */
  readonly periodFrom: DateOnly;
}): React.ReactElement => {
  const { benchmarks, scope, chart } = data;

  // O período é o do filtro da tela: cada barra é o último ponto da série
  // acumulada que parte de 0% na base do período.
  const hasHistory = chart.base_date !== null;
  const partial =
    scope.inception !== null && hasHistory && periodFrom < (scope.inception as DateOnly);

  const bars: Bar[] = [
    {
      id: 'portfolio',
      label: scope.name,
      color: 'var(--color-ink)',
      value: hasHistory ? lastOf(chart.portfolio) : null,
    },
    ...benchmarks.selected.map((item, index): Bar => {
      const series = chart.benchmarks.find((one) => one.id === item.id);
      return {
        id: `benchmark:${item.id}`,
        label: item.name,
        color: benchmarkColor(index),
        value: hasHistory && series !== undefined ? lastOf(series.values) : null,
      };
    }),
  ];
  // Em Todas as carteiras: cada carteira primeiro, depois Todas e os benchmarks.
  if (compare && portfolios !== null) {
    bars.unshift(
      ...portfolios.map((portfolio, index): Bar => ({
        id: `carteira:${portfolio.id}`,
        label: portfolio.name,
        color: colorForSeries(index),
        value: portfolio.value,
      })),
    );
  }

  const scale = Math.max(
    0,
    ...bars.map((bar) => (bar.value === null ? 0 : Math.abs(Number(bar.value)))),
  );

  const gapIds = new Set(benchmarks.gaps.map((gap) => gap.id));
  const missing = benchmarks.selected.filter(
    (item) => !gapIds.has(item.id) && !chart.benchmarks.some((one) => one.id === item.id),
  );

  return (
    <div className="flex flex-col">
      <ul className="flex flex-col gap-4 px-4 py-5">
        {bars.map((bar) => (
          <BarRow key={bar.id} bar={bar} scale={scale} />
        ))}
      </ul>

      {!partial && benchmarks.gaps.length === 0 && missing.length === 0 ? null : (
        <div className="flex flex-wrap items-start justify-between gap-3 border-t border-line px-4 py-3 text-[0.8125rem] text-ink-2">
          <div className="flex min-w-0 flex-col gap-1">
            {partial ? (
              <p>
                Início das movimentações em{' '}
                {formatDate(scope.inception as DateOnly).slice(3)} nesta carteira: o
                período cobre só parte da janela.
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
                . O benchmark aparece como traço, e não como uma barra mais curta.
              </p>
            )}
            {missing.length === 0 ? null : (
              <p className="text-attention">
                Sem dado de índice no período:{' '}
                {missing.map((item) => item.name).join(', ')}. Eles aparecem como traço, e
                não como zero.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

/** "+ Benchmark" no canto do card (as ações dos cards ficam no topo, à direita). */
export const ReturnsBenchmarkAction = ({
  data,
  extraIds,
  onExtraIdsChange,
}: {
  readonly data: PerformanceResource;
  readonly extraIds: readonly string[];
  readonly onExtraIdsChange: (ids: readonly string[]) => void;
}): React.ReactElement => (
  <BenchmarkPicker
    selected={data.benchmarks.selected}
    primaryId={data.benchmarks.primary_id}
    options={availableToAdd(data.benchmarks)}
    onAdd={(id) => onExtraIdsChange(addBenchmark(extraIds, id))}
    onRemove={(id) => onExtraIdsChange(removeBenchmark(extraIds, id))}
  />
);
