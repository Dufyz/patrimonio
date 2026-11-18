import type { PerformanceResource } from '@patrimonio/contracts';
import type { DateOnly } from '@patrimonio/domain';
import { Link } from 'react-router';

import { Money, Percent, PercentChange } from '../../components/number.js';
import { Panel } from '../../components/primitives.js';
import { FinTable, Th, THead } from '../../components/table_parts.js';
import { percentAsRatio } from '../../lib/overview.js';
import { monthColumnLabel, WeightBar } from './alocacao_panel.js';

/**
 * VGR-07 · Carteiras, na forma das pranchas 1.3 e 1.4: uma linha por carteira
 * com Valor, Peso (número e barra), o retorno do mês e o do ano, e o total no
 * pé. A carteira do escopo atual fica em destaque. O retorno vem da leitura de
 * Todas as carteiras (`breakdown.portfolios`); sem ela, ficam em traço.
 */

const returnAt = (
  performance: PerformanceResource,
  returns: readonly (string | null)[],
  window: 'month' | 'ytd',
): string | null => {
  const at = performance.breakdown.columns.findIndex((column) => column.key === window);
  return at < 0 ? null : (returns[at] ?? null);
};

const Cell = ({ value }: { readonly value: string | null }): React.ReactElement =>
  value === null ? (
    <span className="text-ink-3">—</span>
  ) : (
    <PercentChange value={percentAsRatio(value)} decimals={2} />
  );

export const CarteirasPanel = ({
  performance,
  total,
  referenceDate,
  selectedId,
  selectedName,
  portfolioHref,
  compare = false,
  onCompare,
}: {
  /** "Comparar" ao lado do título (Todas as carteiras): liga as carteiras no retorno. */
  readonly compare?: boolean;
  readonly onCompare?: (() => void) | undefined;
  /** A leitura de Todas as carteiras; nula enquanto não chega. */
  readonly performance: PerformanceResource | null;
  readonly total: string;
  readonly referenceDate: string | null;
  /** Nulo é Todas as carteiras. */
  readonly selectedId: string | null;
  readonly selectedName: string | null;
  readonly portfolioHref?: ((portfolioId: string) => string) | undefined;
}): React.ReactElement => {
  const rows = performance?.breakdown.portfolios ?? [];
  const month = monthColumnLabel(referenceDate as DateOnly | null);

  return (
    <Panel
      title="Carteiras"
      hint={
        onCompare === undefined ? undefined : (
          <button
            type="button"
            aria-pressed={compare}
            className="cursor-pointer text-accent hover:underline"
            onClick={onCompare}
          >
            {compare ? 'Parar de comparar' : 'Comparar'}
          </button>
        )
      }
      action={
        <span className="text-xs text-ink-3">
          {selectedName === null
            ? `${rows.length} ${rows.length === 1 ? 'carteira' : 'carteiras'}`
            : `${selectedName} selecionada`}
        </span>
      }
      className="flex flex-col"
    >
      {performance === null ? (
        <p className="p-4 text-[0.8125rem] text-ink-3">Carregando as carteiras…</p>
      ) : rows.length === 0 ? (
        <p className="p-4 text-[0.8125rem] text-ink-3">
          Nenhuma carteira consolidada até a data de referência.
        </p>
      ) : (
        <FinTable caption="Valor e retorno de cada carteira" fill>
          <THead>
            <Th>Carteira</Th>
            <Th align="right">Valor</Th>
            <Th align="right">Peso</Th>
            <Th align="right">{month}</Th>
            <Th align="right">YTD</Th>
          </THead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.portfolio_id}
                aria-current={row.portfolio_id === selectedId ? 'true' : undefined}
                className={`border-t border-line ${
                  row.portfolio_id === selectedId ? 'bg-accent-soft font-medium' : ''
                }`}
              >
                <th
                  scope="row"
                  className="py-[var(--row-pad)] pl-3 text-left font-[inherit] font-medium"
                >
                  {portfolioHref === undefined ? (
                    row.name
                  ) : (
                    <Link
                      to={portfolioHref(row.portfolio_id)}
                      className="cursor-pointer hover:text-accent hover:underline"
                    >
                      {row.name}
                    </Link>
                  )}
                </th>
                <td className="tabular px-3 py-[var(--row-pad)] text-right font-medium">
                  <Money value={row.value} />
                </td>
                <td className="px-3 py-[var(--row-pad)] text-right">
                  <span className="inline-flex items-center justify-end gap-2.5">
                    <WeightBar ratio={percentAsRatio(row.weight_pct)} className="w-12" />
                    <Percent
                      value={percentAsRatio(row.weight_pct)}
                      decimals={1}
                      className="w-12 text-right"
                    />
                  </span>
                </td>
                <td className="tabular px-3 py-[var(--row-pad)] text-right">
                  <Cell value={returnAt(performance, row.returns, 'month')} />
                </td>
                <td className="tabular px-3 py-[var(--row-pad)] text-right">
                  <Cell value={returnAt(performance, row.returns, 'ytd')} />
                </td>
              </tr>
            ))}
            <tr aria-hidden="true" className="h-full">
              <td colSpan={5} />
            </tr>
            <tr className="border-t border-line-2 bg-panel-2 font-semibold">
              <th
                scope="row"
                className="py-[var(--row-pad)] pl-3 text-left font-[inherit]"
              >
                Total
              </th>
              <td className="tabular px-3 py-[var(--row-pad)] text-right">
                <Money value={total} />
              </td>
              <td className="tabular px-3 py-[var(--row-pad)] text-right">100%</td>
              <td colSpan={2} />
            </tr>
          </tbody>
        </FinTable>
      )}
    </Panel>
  );
};
