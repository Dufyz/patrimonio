import { useState } from 'react';

import { Button } from '../../components/primitives.js';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog.js';
import { Field, Input } from '../../views/entry/fields.js';
import { accountLabel } from '../domain/accounts.js';
import { findCard, invoiceTotal } from '../domain/cards.js';
import { payInvoiceDateError } from '../domain/invoice_ops.js';
import type { FinanceData } from '../domain/types.js';
import { formatBRL, formatMonth } from '../lib/format.js';

/**
 * FIN-507 · O modal de pagar fatura: cartão, mês, conta pagadora (a do cartão,
 * não editável), valor (o total) e data (hoje por padrão).
 */
export const PayInvoiceDialog = ({
  data,
  cardId,
  invoice,
  today,
  onConfirm,
  onClose,
}: {
  readonly data: FinanceData;
  readonly cardId: string;
  readonly invoice: string;
  readonly today: string;
  readonly onConfirm: (date: string) => void;
  readonly onClose: () => void;
}): React.ReactElement | null => {
  const card = findCard(data, cardId);
  const [date, setDate] = useState(today);
  const [attempted, setAttempted] = useState(false);
  if (card === undefined) return null;
  const error = attempted ? payInvoiceDateError(date, today) : null;

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-w-md" aria-describedby={undefined}>
        <form
          noValidate
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            setAttempted(true);
            if (payInvoiceDateError(date, today) === null) onConfirm(date);
          }}
        >
          <DialogHeader>
            <DialogTitle>Pagar fatura</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <dl className="grid grid-cols-[8rem_1fr] gap-y-2 text-[0.8125rem]">
              <dt className="text-ink-3">Cartão</dt>
              <dd className="font-medium">{card.name}</dd>
              <dt className="text-ink-3">Fatura</dt>
              <dd className="font-medium">{formatMonth(`${invoice}-01`)}</dd>
              <dt className="text-ink-3">Conta pagadora</dt>
              <dd className="font-medium">{accountLabel(data, card.payerId)}</dd>
              <dt className="text-ink-3">Valor</dt>
              <dd className="tabular font-semibold">
                {formatBRL(invoiceTotal(data, card, invoice))}
              </dd>
            </dl>
            <Field label="Data do pagamento" error={error ?? undefined}>
              {(props) => (
                <Input
                  {...props}
                  type="date"
                  invalid={error !== null}
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                />
              )}
            </Field>
          </DialogBody>
          <DialogFooter className="justify-end">
            <Button type="button" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary">
              Confirmar pagamento
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
