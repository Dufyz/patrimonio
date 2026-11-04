import { Amount } from './amount.js';
import { FinTable, Row, Td, Th, THead } from './fin_table.js';
import { StatusTag } from './tags.js';
import {
  cardInvoiceKeys,
  invoicePeriod,
  invoiceSummary,
  paymentOf,
} from '../domain/cards.js';
import { accountLabel } from '../domain/accounts.js';
import type { Card, FinanceData } from '../domain/types.js';
import { formatDay, formatMonth } from '../lib/format.js';

/** FIN-506 · Todas as faturas do cartão, da mais distante (prevista) à mais antiga. */
export const InvoiceList = ({
  data,
  card,
  today,
  selected,
  onSelect,
}: {
  readonly data: FinanceData;
  readonly card: Card;
  readonly today: string;
  readonly selected: string;
  readonly onSelect: (key: string) => void;
}): React.ReactElement => {
  const keys = [...cardInvoiceKeys(data, card, today)].reverse();
  return (
    <section className="rounded-panel border border-line bg-panel">
      <header className="flex items-baseline justify-between gap-4 border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold">Faturas</h2>
        <span className="text-xs text-ink-3">
          selecione uma fatura para ver o extrato completo
        </span>
      </header>
      <FinTable caption="Faturas do cartão">
        <THead>
          <Th>Fatura</Th>
          <Th>Compras de</Th>
          <Th>Vence</Th>
          <Th align="right">Total</Th>
          <Th>Situação</Th>
        </THead>
        <tbody>
          {keys.map((key) => {
            const invoice = invoiceSummary(data, card, key, today);
            const period = invoicePeriod(card, key);
            const payment = paymentOf(data, card.id, key);
            return (
              <Row
                key={key}
                label={`Fatura ${formatMonth(`${key}-01`)}`}
                selected={key === selected}
                onClick={() => onSelect(key)}
              >
                <Td className="font-medium">{formatMonth(`${key}-01`)}</Td>
                <Td className="tabular text-ink-2">
                  {formatDay(period.from, today)} a {formatDay(period.to, today)}
                </Td>
                <Td className="tabular">{formatDay(invoice.due, today)}</Td>
                <Td numeric>
                  <Amount cents={invoice.total} />
                </Td>
                <Td>
                  <span className="inline-flex flex-wrap items-center gap-x-3">
                    <StatusTag status={invoice.status} />
                    {payment === undefined ? null : (
                      <span className="text-xs text-ink-3">
                        paga em {formatDay(payment.date, today)} ·{' '}
                        {accountLabel(data, payment.accountId)}
                      </span>
                    )}
                  </span>
                </Td>
              </Row>
            );
          })}
        </tbody>
      </FinTable>
    </section>
  );
};
