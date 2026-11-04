import { Link } from 'react-router';

import { recentMovements } from '../domain/accounts.js';
import { categoryColor } from '../lib/category_colors.js';
import { formatDay } from '../lib/format.js';
import { financeRoutes } from '../lib/routes.js';
import { useFinanceData } from '../store/finance_store.js';
import { Amount } from './amount.js';
import { CategoryMarker, FinTable, Row, Td, Th, THead } from './fin_table.js';
import { useFinancePeriod } from './period_provider.js';
import { NatureTag } from './tags.js';

/**
 * FIN-402 · Últimas movimentações.
 *
 * As oito mais recentes de todas as contas, da mais nova para a mais antiga.
 * Vêm da mesma fonte de Lançamentos e do Extrato: nada aqui existe só aqui.
 */
export const RecentMovements = (): React.ReactElement => {
  const data = useFinanceData();
  const { today } = useFinancePeriod();
  const items = recentMovements(data, today, 8);

  return (
    <section
      aria-labelledby="recent-movements-title"
      className="mt-4 rounded-panel border border-line bg-panel"
    >
      <header className="flex items-baseline justify-between gap-4 px-4 py-3">
        <h2 id="recent-movements-title" className="text-[0.9375rem] font-semibold">
          Últimas movimentações
        </h2>
        <Link
          to={financeRoutes.entries()}
          className="text-[0.8125rem] text-accent hover:underline"
        >
          Ver em Lançamentos
        </Link>
      </header>
      <FinTable caption="Últimas movimentações">
        <THead>
          <Th>Data</Th>
          <Th>Descrição</Th>
          <Th>Categoria</Th>
          <Th>Conta</Th>
          <Th>
            <span className="sr-only">Natureza</span>
          </Th>
          <Th align="right">Valor</Th>
        </THead>
        <tbody>
          {items.map((item) => {
            const category = data.categories.find((c) => c.id === item.categoryId);
            return (
              <Row key={item.id}>
                <Td numeric className="!text-left">
                  {formatDay(item.date, today)}
                </Td>
                <Td className="font-medium">{item.description}</Td>
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
                <Td>{item.accountLabel}</Td>
                <Td>
                  <span className="flex flex-wrap gap-1">
                    {item.tags.map((tag) => (
                      <NatureTag key={tag} kind={tag} />
                    ))}
                  </span>
                </Td>
                <Td numeric>
                  <Amount cents={item.cents} variant="flow" />
                </Td>
              </Row>
            );
          })}
        </tbody>
      </FinTable>
    </section>
  );
};
