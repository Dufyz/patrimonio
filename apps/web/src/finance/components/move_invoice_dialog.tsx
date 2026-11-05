import { useState } from 'react';

import { Modal } from '../../components/overlay.js';
import { FormShell } from '../../views/entry/form_shell.js';
import { Field, Select } from '../../views/entry/fields.js';
import { invoiceDue, paymentOf, shiftInvoice } from '../domain/cards.js';
import type { InvoiceLine } from '../domain/cards.js';
import type { Card, FinanceData } from '../domain/types.js';
import { formatDay, formatMonth } from '../lib/format.js';

/**
 * Mover um lançamento de fatura sem mudar a data da compra: serve para quando o
 * vencimento do cartão mudou e a compra precisa cair numa fatura diferente da que
 * a data indicaria. Fatura paga não recebe nem perde lançamentos.
 */
export const MoveInvoiceDialog = ({
  data,
  card,
  line,
  current,
  today,
  onSave,
  onClose,
}: {
  readonly data: FinanceData;
  readonly card: Card;
  readonly line: InvoiceLine;
  readonly current: string;
  readonly today: string;
  readonly onSave: (month: string) => void;
  readonly onClose: () => void;
}): React.ReactElement => {
  const options = [-3, -2, -1, 1, 2, 3, 4, 5, 6]
    .map((delta) => shiftInvoice(current, delta))
    .filter((key) => paymentOf(data, card.id, key) === undefined)
    .map((key) => ({
      id: key,
      name: `${formatMonth(`${key}-01`)} · vence ${formatDay(invoiceDue(card, key), today)}`,
    }));
  const [month, setMonth] = useState(options.find((o) => o.id > current)?.id ?? '');

  return (
    <Modal
      open
      guard
      narrow
      title="Mover de fatura"
      subtitle={`${line.description} continua com a data original`}
      onClose={onClose}
    >
      <FormShell
        pending={false}
        onSave={() => month !== '' && onSave(month)}
        onCancel={onClose}
        saveLabel="Mover"
      >
        <Field label="Fatura de destino">
          {(props) => (
            <Select
              {...props}
              invalid={false}
              options={options}
              value={month}
              onChange={(event) => setMonth(event.target.value)}
            />
          )}
        </Field>
      </FormShell>
    </Modal>
  );
};
