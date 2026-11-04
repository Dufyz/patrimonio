import { Amount } from './amount.js';
import { FinTable, Row, Td, Th, THead } from './fin_table.js';
import { StatusTag } from './tags.js';
import { upcomingInvoices } from '../domain/cards.js';
import type { FinanceData } from '../domain/types.js';
import { formatMonth } from '../lib/format.js';

/** FIN-502 · Próximas faturas por cartão, para planejar o caixa. */
export const UpcomingInvoices = ({
  data,
  today,
}: {
  readonly data: FinanceData;
  readonly today: string;
}): React.ReactElement => {
  const rows = upcomingInvoices(data, today);
  return (
    <section className="rounded-panel border border-line bg-panel">
      <header className="flex items-baseline justify-between gap-4 border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold">Próximas faturas</h2>
        <span className="text-xs text-ink-3">parcelas e recorrentes já previstos</span>
      </header>
      <FinTable caption="Próximas faturas">
        <THead>
          <Th>Fatura de</Th>
          {data.cards.map((card) => (
            <Th key={card.id} align="right">
              {card.name}
            </Th>
          ))}
          <Th align="right">Total</Th>
        </THead>
        <tbody>
          {rows.map((row) => (
            <Row key={row.key} label={`Fatura de ${row.key}`}>
              <Td>
                <span className="inline-flex items-center gap-3">
                  <span className="font-medium">{formatMonth(`${row.key}-01`)}</span>
                  <StatusTag status={row.status} />
                </span>
              </Td>
              {row.cells.map((cell) => (
                <Td key={cell.cardId} numeric>
                  {cell.cents === null ? (
                    <span className="text-ink-3">—</span>
                  ) : (
                    <Amount cents={cell.cents} />
                  )}
                </Td>
              ))}
              <Td numeric className="font-semibold">
                <Amount cents={row.total} />
              </Td>
            </Row>
          ))}
        </tbody>
      </FinTable>
    </section>
  );
};
