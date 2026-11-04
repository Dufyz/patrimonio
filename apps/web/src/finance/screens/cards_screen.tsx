import { useState } from 'react';
import { useNavigate } from 'react-router';

import { Button, IconButton } from '../../components/primitives.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu.js';
import { Amount } from '../components/amount.js';
import {
  FinTable,
  Row,
  SectionRow,
  SummaryRow,
  Td,
  Th,
  THead,
} from '../components/fin_table.js';
import { PayInvoiceDialog } from '../components/pay_invoice_dialog.js';
import { CardDialog } from '../components/card_dialog.js';
import { UpcomingInvoices } from '../components/upcoming_invoices.js';
import { LimitBar } from '../components/limit_bar.js';
import { useFinancePeriod } from '../components/period_provider.js';
import { ScreenHeader } from '../components/screen_header.js';
import { StatusTag } from '../components/tags.js';
import { payInvoice } from '../domain/invoice_ops.js';
import { addCard, updateCard } from '../domain/card_ops.js';
import { cardSummary, openInvoicesTotal } from '../domain/cards.js';
import type { CardSummary } from '../domain/cards.js';
import { PRIMARY_LABELS } from '../lib/header.js';
import { formatBRL, formatDay } from '../lib/format.js';
import { financeRoutes } from '../lib/routes.js';
import { accountLabel } from '../domain/accounts.js';
import type { Card } from '../domain/types.js';
import { useFinanceData, useFinanceStore } from '../store/finance_store.js';

/**
 * FIN-501 · Cartões.
 *
 * Os cartões agrupados pela conta que paga a fatura (RN-40). Cada linha mostra
 * a fatura vigente — a fechada a pagar, ou a aberta (RN-47) — e quanto do limite
 * ela consome.
 */

const dueLabel = (days: number): string => {
  if (days === 0) return 'hoje';
  if (days === 1) return 'em 1 dia';
  if (days > 1) return `em ${days} dias`;
  return days === -1 ? 'há 1 dia' : `há ${-days} dias`;
};

/** Os cartões com o vencimento mais próximo, para o subtítulo. */
export const nextDue = (
  summaries: readonly CardSummary[],
): { readonly date: string; readonly names: readonly string[] } | null => {
  const due = summaries.filter((item) => item.usedCents > 0);
  const first = due.map((item) => item.invoice.due).sort()[0];
  if (first === undefined) return null;
  return {
    date: first,
    names: due.filter((item) => item.invoice.due === first).map((item) => item.card.name),
  };
};

const joinNames = (names: readonly string[]): string =>
  names.length <= 1
    ? (names[0] ?? '')
    : `${names.slice(0, -1).join(', ')} e ${names[names.length - 1] ?? ''}`;

const groupByPayer = (
  summaries: readonly CardSummary[],
): readonly { readonly payerId: string; readonly rows: readonly CardSummary[] }[] => {
  const ids = [...new Set(summaries.map((item) => item.card.payerId))];
  return ids.map((payerId) => ({
    payerId,
    rows: summaries.filter((item) => item.card.payerId === payerId),
  }));
};

export const CardsScreen = (): React.ReactElement => {
  const data = useFinanceData();
  const store = useFinanceStore();
  const { today } = useFinancePeriod();
  const [editing, setEditing] = useState<
    { readonly type: 'new' } | { readonly type: 'edit'; readonly card: Card } | null
  >(null);
  const [paying, setPaying] = useState<CardSummary | null>(null);
  const summaries = data.cards.map((card) => cardSummary(data, card, today));
  const total = openInvoicesTotal(summaries);
  const next = nextDue(summaries);

  return (
    <>
      <ScreenHeader
        title="Cartões"
        primary={{
          label: PRIMARY_LABELS.cards,
          onClick: () => setEditing({ type: 'new' }),
        }}
        subtitle={
          <>
            Faturas abertas <Amount cents={total} />
            {next === null ? null : (
              <>
                {' '}
                · próximo vencimento {formatDay(next.date, today)} (
                {joinNames(next.names)})
              </>
            )}
          </>
        }
      />

      <section className="rounded-panel border border-line bg-panel">
        <FinTable caption="Cartões por conta">
          <THead>
            <Th>Cartão</Th>
            <Th align="right">Fatura</Th>
            <Th>Situação</Th>
            <Th>Vence</Th>
            <Th>Limite usado</Th>
            <Th>
              <span className="sr-only">Ações</span>
            </Th>
          </THead>
          <tbody>
            {groupByPayer(summaries).map((group) => {
              const sum = group.rows.reduce((acc, item) => acc + item.usedCents, 0);
              return (
                <GroupRows
                  key={group.payerId}
                  label={`${accountLabel(data, group.payerId)} paga ${
                    group.rows.length === 1 ? '1 cartão' : `${group.rows.length} cartões`
                  }`}
                  sum={sum}
                  rows={group.rows}
                  today={today}
                  onEdit={(card) => setEditing({ type: 'edit', card })}
                  onPay={setPaying}
                />
              );
            })}
            <SummaryRow kind="total">
              <Td>Faturas abertas</Td>
              <Td numeric>
                <Amount cents={total} />
              </Td>
              <Td />
              <Td />
              <Td />
              <Td />
            </SummaryRow>
          </tbody>
        </FinTable>
      </section>

      <UpcomingInvoices data={data} today={today} />

      {paying === null ? null : (
        <PayInvoiceDialog
          data={data}
          cardId={paying.card.id}
          invoice={paying.invoice.key}
          today={today}
          onClose={() => setPaying(null)}
          onConfirm={(date) => {
            store.set((current) =>
              payInvoice(current, paying.card.id, paying.invoice.key, date, today),
            );
            setPaying(null);
          }}
        />
      )}

      {editing === null ? null : (
        <CardDialog
          data={data}
          card={editing.type === 'edit' ? editing.card : undefined}
          onClose={() => setEditing(null)}
          onSave={(draft) => {
            store.set((current) =>
              editing.type === 'edit'
                ? updateCard(current, editing.card.id, draft)
                : addCard(current, draft),
            );
            setEditing(null);
          }}
        />
      )}
    </>
  );
};

const GroupRows = ({
  label,
  sum,
  rows,
  today,
  onEdit,
  onPay,
}: {
  readonly label: string;
  readonly sum: number;
  readonly rows: readonly CardSummary[];
  readonly today: string;
  readonly onEdit: (card: Card) => void;
  readonly onPay: (item: CardSummary) => void;
}): React.ReactElement => (
  <>
    <SectionRow colSpan={6} label={label} summary={formatBRL(sum)} />
    {rows.map((item) => (
      <CardRow
        key={item.card.id}
        item={item}
        today={today}
        onEdit={onEdit}
        onPay={onPay}
      />
    ))}
  </>
);

const CardRow = ({
  item,
  today,
  onEdit,
  onPay,
}: {
  readonly item: CardSummary;
  readonly today: string;
  readonly onEdit: (card: Card) => void;
  readonly onPay: (item: CardSummary) => void;
}): React.ReactElement => {
  const navigate = useNavigate();
  const { card, invoice } = item;
  const closed = invoice.status === 'fechada';
  return (
    <Row label={card.name} onClick={() => void navigate(financeRoutes.card(card.id))}>
      <Td>
        <div className="font-medium">{card.name}</div>
        <div className="text-xs text-ink-3">final {card.last4}</div>
      </Td>
      <Td numeric className="font-medium">
        <Amount cents={invoice.total} />
      </Td>
      <Td>
        <StatusTag
          status={invoice.status === 'paga' ? 'paga' : closed ? 'fechada' : 'aberta'}
          label={
            closed ? 'fechada' : `aberta · fecha ${formatDay(invoice.closing, today)}`
          }
        />
      </Td>
      <Td>
        <div>{formatDay(invoice.due, today)}</div>
        <div className="text-xs text-ink-3">{dueLabel(item.daysToDue)}</div>
      </Td>
      <Td>
        <LimitBar percent={item.usedPercent} />
      </Td>
      <Td align="right" className="w-44">
        <span
          className="inline-flex items-center gap-1"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <Button
            aria-label={`Pagar fatura ${card.name}`}
            disabled={invoice.status === 'paga' || invoice.total <= 0}
            onClick={() => onPay(item)}
          >
            Pagar fatura
          </Button>
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <IconButton row label={`Ações de ${card.name}`} icon="dots" />
            </DropdownMenuTrigger>
            <DropdownMenuContent className="min-w-40">
              <DropdownMenuItem onSelect={() => onEdit(card)}>Editar</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      </Td>
    </Row>
  );
};
