import { Link } from 'react-router';

import { cn } from '../../lib/cn.js';
import { categoryColor } from '../lib/category_colors.js';
import { formatChangePercent, formatMonth, formatPercentTenths } from '../lib/format.js';
import { formatRange, isWholeMonth } from '../lib/period.js';
import type { DateRange } from '../lib/period.js';
import { financeRoutes } from '../lib/routes.js';
import { Amount } from './amount.js';
import { CategoryMarker, FinTable, Row, Td, Th, THead } from './fin_table.js';
import type { CategoryBreakdown as Breakdown } from '../domain/overview.js';
import type { Category } from '../domain/types.js';

/**
 * FIN-603 · Despesas por categoria: a proporção de cada uma numa barra
 * empilhada e a tabela com a comparação do período anterior (RN-62).
 */

const tone = (current: number, previous: number): string =>
  current < previous
    ? 'text-positive'
    : current > previous
      ? 'text-negative'
      : 'text-ink-3';

export const CategoryBreakdown = ({
  breakdown,
  categories,
  range,
  today,
}: {
  readonly breakdown: Breakdown;
  readonly categories: readonly Category[];
  readonly range: DateRange;
  readonly today: string;
}): React.ReactElement => {
  const includesToday = range.from <= today && today <= range.to;
  const label = isWholeMonth(range) ? formatMonth(range.from) : formatRange(range, today);
  const comparison = breakdown.comparison;
  const comparisonLabel = (
    isWholeMonth(comparison)
      ? formatMonth(comparison.from)
      : formatRange(comparison, today)
  ).toUpperCase();
  const lookup = (id: string): Category | undefined =>
    categories.find((c) => c.id === id);

  return (
    <section
      aria-labelledby="categories-title"
      className="rounded-panel border border-line bg-panel"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-4 px-5 pt-4 pb-3">
        <div className="flex items-baseline gap-3">
          <h2 id="categories-title" className="text-[0.9375rem] font-semibold">
            Despesas por categoria
          </h2>
          <span className="text-xs text-ink-3">
            {label}
            {includesToday ? ' · até agora' : ''}
          </span>
        </div>
        <Link
          to={financeRoutes.entries()}
          className="text-[0.8125rem] text-accent hover:underline"
        >
          Ver os lançamentos
        </Link>
      </header>
      {breakdown.rows.length === 0 ? (
        <p className="px-5 pb-5 text-[0.8125rem] text-ink-3">
          Nenhuma despesa lançada no período.
        </p>
      ) : (
        <>
          <div
            role="img"
            aria-label="Proporção de cada categoria nas despesas"
            className="mx-5 mb-3 flex h-2.5 overflow-hidden rounded-full bg-line"
          >
            {breakdown.rows.map((row) => (
              <span
                key={row.categoryId}
                data-category={row.categoryId}
                style={{
                  width: `${row.tenths / 10}%`,
                  background: categoryColor(lookup(row.categoryId)?.color),
                }}
              />
            ))}
          </div>
          <FinTable caption="Despesas por categoria">
            <THead>
              <Th>Categoria</Th>
              <Th align="right">Despesa</Th>
              <Th align="right">{comparisonLabel}</Th>
              <Th align="right">Variação</Th>
              <Th>% do total</Th>
            </THead>
            <tbody>
              {breakdown.rows.map((row) => {
                const category = lookup(row.categoryId);
                const change = formatChangePercent(row.cents, row.previous);
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
                    <Td numeric className="text-ink-3">
                      <Amount cents={row.previous} />
                    </Td>
                    <Td numeric className={cn(tone(row.cents, row.previous))}>
                      {change ?? '—'}
                    </Td>
                    <Td>
                      <span className="inline-flex items-center gap-2.5">
                        <span className="relative h-1 w-24 overflow-hidden rounded-full bg-line">
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
            </tbody>
          </FinTable>
        </>
      )}
    </section>
  );
};
