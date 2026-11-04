import { Link } from 'react-router';

import type { Statement } from '../domain/accounts.js';
import type { Account, FinanceData } from '../domain/types.js';
import { categoryColor } from '../lib/category_colors.js';
import { formatDay, formatMonth } from '../lib/format.js';
import { pluralize } from '../lib/header.js';
import { formatRange, isWholeMonth } from '../lib/period.js';
import type { DateRange } from '../lib/period.js';
import { financeRoutes } from '../lib/routes.js';
import { Amount } from './amount.js';
import { CategoryMarker, FinTable, Row, Td, Th, THead } from './fin_table.js';
import { NatureTag } from './tags.js';

/**
 * FIN-407 · O painel Extrato: as movimentações da conta com o saldo após cada
 * uma, da mais nova para a mais antiga. O saldo após é calculado em ordem
 * cronológica (com desempate estável no mesmo dia) e só então a lista é virada.
 * Compra de cartão não aparece: o pagamento da fatura é uma linha só.
 */
export const StatementTable = ({
  data,
  account,
  statement,
  range,
  today,
}: {
  readonly data: FinanceData;
  readonly account: Account;
  readonly statement: Statement;
  readonly range: DateRange;
  readonly today: string;
}): React.ReactElement => {
  const lines = statement.lines.toReversed();
  const period = isWholeMonth(range)
    ? formatMonth(range.from)
    : formatRange(range, today);

  return (
    <section
      aria-labelledby="statement-title"
      className="mt-4 rounded-panel border border-line bg-panel shadow-panel"
    >
      <header className="flex items-baseline justify-between gap-4 px-5 py-3">
        <h2 id="statement-title" className="text-[0.9375rem] font-semibold">
          Extrato
        </h2>
        <p className="text-[0.8125rem] text-ink-3">
          {period} · {pluralize(lines.length, 'movimentação', 'movimentações')}
        </p>
      </header>
      <FinTable caption={`Extrato de ${account.name}`}>
        <THead>
          <Th>Data</Th>
          <Th>Descrição</Th>
          <Th>Categoria</Th>
          <Th>
            <span className="sr-only">Natureza</span>
          </Th>
          <Th align="right">Valor</Th>
          <Th align="right">Saldo após</Th>
        </THead>
        <tbody>
          {lines.length === 0 ? (
            <tr>
              <td
                colSpan={6}
                className="px-5 py-8 text-center text-[0.8125rem] text-ink-3"
              >
                Sem movimentações neste período.
              </td>
            </tr>
          ) : (
            lines.map((line) => {
              const category = data.categories.find((c) => c.id === line.categoryId);
              return (
                <Row key={line.id}>
                  <Td numeric className="!text-left">
                    {formatDay(line.date, today)}
                  </Td>
                  <Td>
                    <div className="font-medium">{line.description}</div>
                    {line.note === undefined ? null : (
                      <div className="text-xs text-ink-3">{line.note}</div>
                    )}
                  </Td>
                  <Td>
                    {category === undefined ? (
                      '—'
                    ) : (
                      <CategoryMarker
                        color={categoryColor(category.color)}
                        name={category.name}
                      />
                    )}
                  </Td>
                  <Td>
                    <span className="flex flex-wrap gap-1">
                      {line.tags.map((tag) => (
                        <NatureTag key={tag} kind={tag} />
                      ))}
                    </span>
                  </Td>
                  <Td numeric>
                    <Amount cents={line.cents} variant="flow" />
                  </Td>
                  <Td numeric className="text-ink-2">
                    <Amount cents={line.balanceAfter} />
                  </Td>
                </Row>
              );
            })
          )}
        </tbody>
      </FinTable>
      <footer className="border-t border-line px-5 py-3 text-[0.8125rem]">
        <Link
          to={financeRoutes.entries(`conta=${encodeURIComponent(account.id)}`)}
          className="text-accent hover:underline"
        >
          Ver em Lançamentos com filtro desta conta
        </Link>
      </footer>
    </section>
  );
};
