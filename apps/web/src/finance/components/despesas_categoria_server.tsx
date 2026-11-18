import { fetchCategoryBreakdown } from '../../api/category_breakdown.js';
import { Panel } from '../../components/primitives.js';
import { useResource } from '../../lib/use_resource.js';
import { categoryColor } from '../lib/category_colors.js';
import { formatMonth, formatPercentTenths } from '../lib/format.js';
import { formatRange, isWholeMonth } from '../lib/period.js';
import type { DateRange } from '../lib/period.js';
import type { IsoDate } from '../lib/dates.js';
import { Money } from '../../components/number.js';
import {
  CategoryMarker,
  FillRow,
  FinTable,
  Row,
  Td,
  Th,
  THead,
} from '../../components/table_parts.js';
import { EmptyPanel, PanelError, PanelLoading } from './states.js';

/**
 * VGR-10 · Despesas por categoria, lidas do servidor: só lançados, da maior
 * para a menor, e o total é o mesmo de Despesas na cascata e em Lançamentos.
 * Aporte não é categoria de despesa.
 */

export const DespesasCategoriaServerPanel = ({
  range,
  today,
}: {
  readonly range: DateRange;
  readonly today: IsoDate;
}): React.ReactElement => {
  const resource = useResource(
    (signal) => fetchCategoryBreakdown({ from: range.from, to: range.to }, signal),
    [range.from, range.to],
  );
  const label = isWholeMonth(range) ? formatMonth(range.from) : formatRange(range, today);
  const state = resource.state;

  return (
    <Panel
      title="Despesas por categoria"
      action={<span className="text-xs text-ink-3">{label}</span>}
      className="h-full"
    >
      {state.kind === 'loading' ? (
        <PanelLoading label="Carregando despesas por categoria" rows={5} columns={4} />
      ) : state.kind === 'error' ? (
        <PanelError
          title="Não foi possível carregar as despesas por categoria"
          onRetry={resource.reload}
        />
      ) : state.value.rows.length === 0 ? (
        <EmptyPanel message="Nenhuma despesa lançada no período." />
      ) : (
        <>
          <FinTable caption="Despesas por categoria" fill>
            <THead>
              <Th>Categoria</Th>
              <Th align="right">Lançado</Th>
              <Th align="right">Previsto no mês</Th>
              <Th align="right">Peso</Th>
            </THead>
            <tbody>
              {state.value.rows.map((row) => (
                <Row key={row.category_id} label={row.name}>
                  <Td>
                    <CategoryMarker color={categoryColor(row.color)} name={row.name} />
                  </Td>
                  <Td numeric className="font-medium">
                    <Money value={row.amount} bare />
                  </Td>
                  <Td numeric>
                    <Money value={row.projected} bare />
                  </Td>
                  <Td numeric>
                    <span
                      role="img"
                      aria-label={`${formatPercentTenths(row.tenths)} do lançado`}
                      className="relative inline-block h-1 w-20 overflow-hidden rounded-full bg-line align-middle"
                    >
                      <span
                        className="absolute inset-y-0 left-0 rounded-full bg-ink-3"
                        style={{ width: `${row.tenths / 10}%` }}
                      />
                    </span>
                  </Td>
                </Row>
              ))}
              <FillRow colSpan={4} />
              <tr className="border-t border-line-strong bg-panel-2 font-semibold">
                <th
                  scope="row"
                  className="py-[var(--row-pad)] pl-3 text-left font-[inherit]"
                >
                  Total de despesas
                </th>
                <td className="tabular py-[var(--row-pad)] pr-3 text-right">
                  <Money value={state.value.total} bare />
                </td>
                <td className="tabular py-[var(--row-pad)] pr-3 text-right">
                  <Money value={state.value.projected_total} bare />
                </td>
                <td />
              </tr>
            </tbody>
          </FinTable>
        </>
      )}
    </Panel>
  );
};
