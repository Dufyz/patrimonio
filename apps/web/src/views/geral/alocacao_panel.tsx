import type { OverviewResource, PerformanceResource } from '@patrimonio/contracts';
import type { DateOnly } from '@patrimonio/domain';
import { Link } from 'react-router';

import { Money, Percent, PercentChange, Points } from '../../components/number.js';
import { Panel } from '../../components/primitives.js';
import { FinTable, Th, THead } from '../../components/table_parts.js';
import { formatMonthShort } from '../../finance/lib/format.js';
import { percentAsRatio } from '../../lib/overview.js';
import { colorForToken } from '../../lib/tokens.js';

/**
 * VGR-06 · Alocação por classe, na forma das pranchas 1.1, 1.3 e 1.4: uma linha
 * por classe com Valor, Peso (número e barra), o retorno do mês e o do ano — ou,
 * numa carteira, Alvo e Vs alvo no lugar do retorno do mês. O retorno vem da
 * leitura de desempenho do mesmo escopo; classe sem base fica em traço (nunca
 * zero). Em Todas o alvo é de cada carteira, e a nota diz isso.
 */

type Node = OverviewResource['composition']['nodes'][number];

/** `2026-10-16` → `OUT/26`, o cabeçalho da coluna do mês da consolidação. */
export const monthColumnLabel = (referenceDate: string | null): string =>
  referenceDate === null
    ? 'MÊS'
    : `${formatMonthShort(referenceDate as DateOnly).toUpperCase()}/${referenceDate.slice(2, 4)}`;

const returnOf = (
  performance: PerformanceResource | null,
  node: Node,
  window: 'month' | 'ytd',
): string | null | undefined => {
  if (performance === null) return undefined;
  const at = performance.breakdown.columns.findIndex((column) => column.key === window);
  if (at < 0) return null;
  const row =
    performance.breakdown.classes.find((item) => item.category_id === node.id) ??
    performance.breakdown.classes.find((item) => item.name === node.name);
  return row === undefined ? null : (row.returns[at] ?? null);
};

const ReturnCell = ({
  value,
}: {
  readonly value: string | null | undefined;
}): React.ReactElement =>
  value === undefined || value === null ? (
    <span className="text-ink-3">—</span>
  ) : (
    <PercentChange value={percentAsRatio(value)} decimals={2} />
  );

/** A barra do peso: geometria da razão que a `api` mandou, ao lado do número. */
export const WeightBar = ({
  ratio,
  className = 'w-16',
}: {
  readonly ratio: string | null;
  /** A largura: a prancha usa barras curtas nas tabelas de muitas colunas. */
  readonly className?: string;
}): React.ReactElement => {
  const parsed = ratio === null ? 0 : Number(ratio);
  const width = Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed * 100)) : 0;
  return (
    <span
      aria-hidden="true"
      className={`inline-block h-1 overflow-hidden rounded-full bg-line align-middle ${className}`}
    >
      <span
        className="block h-full rounded-full bg-ink-2"
        style={{ width: `${width}%` }}
      />
    </span>
  );
};

export const AlocacaoPanel = ({
  overview,
  performance,
  classHref,
  hint,
}: {
  readonly overview: OverviewResource;
  /** Nulo enquanto não chega: as colunas de retorno ficam em traço. */
  readonly performance: PerformanceResource | null;
  readonly classHref?: ((classId: string) => string) | undefined;
  /** O texto do cabeçalho: "somando as carteiras" ou o nome da carteira. */
  readonly hint: string;
}): React.ReactElement => {
  const nodes = overview.composition.nodes;
  const consolidated = overview.scope.portfolio_id === null;
  const month = monthColumnLabel(overview.reference_date);
  const columns = consolidated ? 5 : 6;

  return (
    <Panel
      title="Alocação por classe"
      action={<span className="text-xs text-ink-3">{hint}</span>}
      className="flex flex-col"
    >
      {nodes.length === 0 ? (
        <p className="p-4 text-[0.8125rem] text-ink-3">
          Sem posição em carteira na data da consolidação.
        </p>
      ) : (
        <FinTable caption="Distribuição por classe de ativo" fill>
          <THead>
            <Th>Classe</Th>
            <Th align="right">Valor</Th>
            <Th align="right">Peso</Th>
            {consolidated ? (
              <Th align="right">{month}</Th>
            ) : (
              <>
                <Th align="right">Alvo</Th>
                <Th align="right">Vs alvo</Th>
              </>
            )}
            <Th align="right">YTD</Th>
          </THead>
          <tbody>
            {nodes.map((node) => (
              <tr key={node.id} className="border-t border-line">
                <th
                  scope="row"
                  className="py-[var(--row-pad)] pl-3 text-left font-normal"
                >
                  <span className="flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className="size-2 shrink-0 rounded-xs"
                      style={{ backgroundColor: colorForToken(node.color_token) }}
                    />
                    {classHref === undefined ? (
                      node.name
                    ) : (
                      <Link
                        to={classHref(node.id)}
                        className="cursor-pointer hover:text-accent hover:underline"
                      >
                        {node.name}
                      </Link>
                    )}
                  </span>
                </th>
                <td className="tabular px-3 py-[var(--row-pad)] text-right font-medium">
                  <Money value={node.value} />
                </td>
                <td className="px-3 py-[var(--row-pad)] text-right">
                  <span className="inline-flex items-center justify-end gap-2.5">
                    <WeightBar ratio={percentAsRatio(node.current_pct)} className="w-8" />
                    <Percent
                      value={percentAsRatio(node.current_pct)}
                      decimals={1}
                      className="w-12 text-right"
                    />
                  </span>
                </td>
                {consolidated ? (
                  <td className="tabular px-3 py-[var(--row-pad)] text-right">
                    <ReturnCell value={returnOf(performance, node, 'month')} />
                  </td>
                ) : (
                  <>
                    <td className="tabular px-3 py-[var(--row-pad)] text-right text-ink-2">
                      {node.target_pct === null ? (
                        <span className="text-ink-3">—</span>
                      ) : (
                        <Percent value={percentAsRatio(node.target_pct)} decimals={0} />
                      )}
                    </td>
                    <td className="tabular px-3 py-[var(--row-pad)] text-right">
                      <Points
                        value={node.deviation_pp}
                        decimals={1}
                        tone={node.over_tolerance ? 'attention' : 'muted'}
                      />
                    </td>
                  </>
                )}
                <td className="tabular px-3 py-[var(--row-pad)] text-right">
                  <ReturnCell value={returnOf(performance, node, 'ytd')} />
                </td>
              </tr>
            ))}
            <tr aria-hidden="true" className="h-full">
              <td colSpan={columns} />
            </tr>
            <tr className="border-t border-line-2 bg-panel-2 font-semibold">
              <th
                scope="row"
                className="py-[var(--row-pad)] pl-3 text-left font-[inherit]"
              >
                Total
              </th>
              <td className="tabular px-3 py-[var(--row-pad)] text-right">
                <Money value={overview.composition.total} />
              </td>
              <td className="tabular px-3 py-[var(--row-pad)] text-right">100%</td>
              <td colSpan={columns - 3} />
            </tr>
          </tbody>
        </FinTable>
      )}
    </Panel>
  );
};
