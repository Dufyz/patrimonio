import { useState } from 'react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router';

import { Button, IconButton } from '../../components/primitives.js';
import { Amount } from '../components/amount.js';
import { CardItemDialog } from '../components/card_item_dialog.js';
import { ConfirmDialog } from '../components/entry_confirms.js';
import { PayInvoiceDialog } from '../components/pay_invoice_dialog.js';
import { CreditDialog } from '../components/credit_dialog.js';
import { InvoiceList } from '../components/invoice_list.js';
import { InvoiceStatement } from '../components/invoice_statement.js';
import { CardDialog } from '../components/card_dialog.js';
import { EntryDialog } from '../components/entry_dialog.js';
import { useFinancePeriod } from '../components/period_provider.js';
import { ScreenHeader } from '../components/screen_header.js';
import { StatusTag } from '../components/tags.js';
import { updateCard } from '../domain/card_ops.js';
import {
  cardInvoiceKeys,
  cardSummary,
  findCard,
  invoiceLines,
  invoicePeriod,
  invoiceSummary,
  paymentOf,
  vigenteKey,
} from '../domain/cards.js';
import { payBlockedReason, payInvoice } from '../domain/invoice_ops.js';
import { addCredit, deleteCardItem, updateCardItem } from '../domain/card_item_ops.js';
import {
  addEntry,
  deleteEntries,
  draftOfEntry,
  emptyEntryDraft,
  updateEntry,
} from '../domain/entry_ops.js';
import { accountLabel } from '../domain/accounts.js';
import type { InvoiceLine } from '../domain/cards.js';
import type { Card } from '../domain/types.js';
import { formatBRL, formatDay, formatMonth } from '../lib/format.js';
import { formatPercentValue } from '../components/limit_bar.js';
import { PRIMARY_LABELS } from '../lib/header.js';
import { financeRoutes } from '../lib/routes.js';
import { useFinanceData, useFinanceStore } from '../store/finance_store.js';

/**
 * FIN-504 · Fatura de um cartão: cabeçalho e navegador de mês.
 *
 * A fatura exibida vai na URL (`?fatura=2026-11`, o mês de vencimento, RN-41).
 * As setas andam entre a mais antiga e a última prevista.
 */
export const CardScreen = (): React.ReactElement => {
  const { id = '' } = useParams();
  const data = useFinanceData();
  const card = findCard(data, id);
  if (card === undefined) return <Navigate to={financeRoutes.cards()} replace />;
  return <CardInvoices card={card} />;
};

const CardInvoices = ({ card }: { readonly card: Card }): React.ReactElement => {
  const data = useFinanceData();
  const store = useFinanceStore();
  const navigate = useNavigate();
  const { today } = useFinancePeriod();
  const [search, setSearch] = useSearchParams();
  const [dialog, setDialog] = useState<'edit' | 'entry' | 'pay' | 'credit' | null>(null);
  const [editingLine, setEditingLine] = useState<InvoiceLine | null>(null);
  const [deletingLine, setDeletingLine] = useState<InvoiceLine | null>(null);

  const keys = cardInvoiceKeys(data, card, today);
  const requested = search.get('fatura');
  const key =
    requested !== null && keys.includes(requested)
      ? requested
      : vigenteKey(data, card, today);
  const index = keys.indexOf(key);
  const summary = cardSummary(data, card, today);
  const invoice = invoiceSummary(data, card, key, today);
  const period = invoicePeriod(card, key);
  const payment = paymentOf(data, card.id, key);
  const lines = invoiceLines(data, card, key);

  const go = (target: string | undefined): void => {
    if (target !== undefined) setSearch({ fatura: target }, { replace: true });
  };

  return (
    <>
      <ScreenHeader
        title={card.name}
        subtitle={`final ${card.last4} · pertence a ${accountLabel(data, card.payerId)} · limite ${formatBRL(
          card.limitCents,
        )} · usado ${formatPercentValue(summary.usedPercent)} · disponível ${formatBRL(
          summary.availableCents,
        )}`}
        crumbs={[{ label: 'Cartões', to: financeRoutes.cards() }, { label: card.name }]}
        extra={<Button onClick={() => setDialog('edit')}>Editar</Button>}
        primary={{ label: PRIMARY_LABELS.entries, onClick: () => setDialog('entry') }}
      />

      <section
        aria-label="Fatura"
        className="rounded-panel border border-line bg-panel shadow-panel"
      >
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
          <div className="flex items-center gap-3">
            <h2 className="text-[1.0625rem] font-semibold">Fatura</h2>
            <div
              className="flex items-center gap-1"
              role="group"
              aria-label="Mês da fatura"
            >
              <IconButton
                label="Fatura anterior"
                icon="chevron-left"
                disabled={index <= 0}
                onClick={() => go(keys[index - 1])}
              />
              <span className="tabular min-w-20 text-center font-medium">
                {formatMonth(`${key}-01`)}
              </span>
              <IconButton
                label="Próxima fatura"
                icon="chevron-right"
                disabled={index < 0 || index >= keys.length - 1}
                onClick={() => go(keys[index + 1])}
              />
            </div>
            <StatusTag status={invoice.status} />
          </div>
          {invoice.status === 'paga' ? null : (
            <div className="flex items-center gap-2">
              <Button onClick={() => setDialog('credit')}>Lançar crédito</Button>
              <Button
                variant="primary"
                disabled={payBlockedReason(data, card.id, key, today) !== null}
                onClick={() => setDialog('pay')}
              >
                Pagar fatura
              </Button>
            </div>
          )}
        </header>
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-5 py-5">
          <span
            className="text-[2.125rem] leading-none font-semibold"
            aria-label="Total da fatura"
          >
            <Amount cents={invoice.total} />
          </span>
          <p className="text-[0.8125rem] text-ink-3">
            compras de {formatDay(period.from, today)} a {formatDay(period.to, today)} ·
            fecha em {formatDay(invoice.closing, today)} · vence em{' '}
            {formatDay(invoice.due, today)} ·{' '}
            {payment === undefined
              ? `paga com ${accountLabel(data, card.payerId)}`
              : `paga em ${formatDay(payment.date, today)} · ${accountLabel(data, payment.accountId)}`}
          </p>
        </div>
      </section>

      <InvoiceStatement
        lines={lines}
        categories={data.categories}
        period={period}
        today={today}
        locked={payment !== undefined}
        onEdit={setEditingLine}
        onDelete={setDeletingLine}
      />

      <InvoiceList data={data} card={card} today={today} selected={key} onSelect={go} />

      {editingLine?.origin === 'entry' ? (
        <EntryDialog
          mode="edit"
          data={data}
          today={today}
          initial={draftOfEntry(
            data.entries.find((e) => e.id === editingLine.id) ?? data.entries[0]!,
            today,
          )}
          ignoreEntryId={editingLine.id}
          onClose={() => setEditingLine(null)}
          onSave={(draft) => {
            store.set((current) => updateEntry(current, editingLine.id, draft, today));
            setEditingLine(null);
          }}
        />
      ) : null}
      {editingLine?.origin === 'item' ? (
        <CardItemDialog
          data={data}
          item={data.cardItems.find((i) => i.id === editingLine.id)!}
          onClose={() => setEditingLine(null)}
          onSave={(draft) => {
            store.set((current) => updateCardItem(current, editingLine.id, draft));
            setEditingLine(null);
          }}
        />
      ) : null}
      {deletingLine === null ? null : (
        <ConfirmDialog
          title="Excluir da fatura"
          confirmLabel="Excluir"
          danger
          onClose={() => setDeletingLine(null)}
          onConfirm={() => {
            store.set((current) =>
              deletingLine.origin === 'entry'
                ? deleteEntries(current, [deletingLine.id])
                : deleteCardItem(current, deletingLine.id),
            );
            setDeletingLine(null);
          }}
        >
          <p>{deletingLine.description} sai da fatura e o total é recalculado.</p>
        </ConfirmDialog>
      )}

      {dialog === 'credit' ? (
        <CreditDialog
          data={data}
          today={today}
          onClose={() => setDialog(null)}
          onSave={(draft) => {
            store.set((current) => addCredit(current, card.id, key, draft));
            setDialog(null);
          }}
        />
      ) : null}
      {dialog === 'pay' ? (
        <PayInvoiceDialog
          data={data}
          cardId={card.id}
          invoice={key}
          today={today}
          onClose={() => setDialog(null)}
          onConfirm={(date) => {
            store.set((current) => payInvoice(current, card.id, key, date, today));
            setDialog(null);
          }}
        />
      ) : null}
      {dialog === 'edit' ? (
        <CardDialog
          data={data}
          card={card}
          onClose={() => setDialog(null)}
          onSave={(draft) => {
            store.set((current) => updateCard(current, card.id, draft));
            setDialog(null);
          }}
        />
      ) : null}
      {dialog === 'entry' ? (
        <EntryDialog
          mode="new"
          data={data}
          today={today}
          initial={{ ...emptyEntryDraft(today), sourceId: card.id }}
          onClose={() => setDialog(null)}
          onCreateRecurring={() => navigate(financeRoutes.recurrings())}
          onSave={(draft) => {
            store.set((current) => addEntry(current, draft, today));
            setDialog(null);
          }}
        />
      ) : null}
    </>
  );
};
