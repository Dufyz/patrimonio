import type { BookRowResource } from '@patrimonio/contracts';
import { useEffect, useState } from 'react';

import { moveEntryInvoice, reverseCardEntry } from '../../api/book.js';
import { AlertModal } from '../../components/overlay.js';
import { formatMoney } from '../../lib/format.js';
import { Select } from '../entry/fields.js';

const MONTH_NAMES = [
  'jan',
  'fev',
  'mar',
  'abr',
  'mai',
  'jun',
  'jul',
  'ago',
  'set',
  'out',
  'nov',
  'dez',
];

/** As faturas de três meses antes a doze depois da compra, como "fatura de dez/26". */
const invoiceMonths = (date: string): readonly { id: string; name: string }[] => {
  if (!/^\d{4}-\d{2}/.test(date)) return [];
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7)) - 1;
  return Array.from({ length: 16 }, (_, index) => {
    const total = year * 12 + month - 3 + index;
    const y = Math.floor(total / 12);
    const m = total % 12;
    return {
      id: `${y}-${String(m + 1).padStart(2, '0')}`,
      name: `Fatura de ${MONTH_NAMES[m] ?? ''}/${String(y).slice(2)}`,
    };
  });
};
import { reversalBody } from '../../lib/ledger_batch.js';

export type CardRowAction = 'move_invoice' | 'reverse';

/**
 * LAN-07 · Mover de fatura e Estornar, para despesa lançada no cartão. Mover
 * pede o mês da fatura de destino; Estornar mostra o crédito que vai nascer na
 * fatura (valor todo, ligado ao lançamento) e só grava ao confirmar.
 */
export const CardRowDialog = ({
  row,
  action,
  hidden,
  onClose,
  onDone,
}: {
  readonly row: BookRowResource | null;
  readonly action: CardRowAction | null;
  readonly hidden: boolean;
  readonly onClose: () => void;
  readonly onDone: () => void;
}): React.ReactElement => {
  const [month, setMonth] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (row === null) return;
    setMonth(row.date.slice(0, 7));
    setError(null);
  }, [row, action]);

  const open = row !== null && action !== null;
  const run = (): void => {
    if (row === null) return;
    setBusy(true);
    setError(null);
    const job =
      action === 'move_invoice'
        ? moveEntryInvoice(row.id, month)
        : (() => {
            const body = reversalBody(row);
            if (body === null)
              return Promise.reject(new Error('Esta movimentação não é de cartão.'));
            const { cardId, ...rest } = body;
            return reverseCardEntry(cardId, rest);
          })();
    job
      .then(() => {
        onClose();
        onDone();
      })
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : 'Não foi possível concluir'),
      )
      .finally(() => setBusy(false));
  };

  const amount =
    row?.amount === null || row === null ? '' : formatMoney(row.amount, { hidden }).text;

  return (
    <AlertModal
      icon={action === 'reverse' ? 'undo' : 'swap'}
      open={open}
      title={
        action === 'reverse'
          ? `Estornar ${row?.description ?? ''}?`
          : `Mover ${row?.description ?? ''} de fatura`
      }
      message={
        <span className="flex flex-col gap-3">
          {action === 'reverse' ? (
            <span>
              Cria um crédito de estorno de {amount} na fatura de {row?.date.slice(0, 7)},
              ligado a esta movimentação. A despesa original continua no histórico.
            </span>
          ) : (
            <label className="flex flex-col gap-1">
              Fatura de destino (mês)
              <Select
                invalid={false}
                placeholder="Escolha a fatura"
                options={invoiceMonths(row?.date ?? '')}
                value={month}
                onChange={(e) => setMonth(e.target.value)}
              />
            </label>
          )}
          {error === null ? null : (
            <span role="alert" className="text-negative">
              {error}
            </span>
          )}
        </span>
      }
      cancelLabel="Cancelar"
      confirmLabel={action === 'reverse' ? 'Estornar' : 'Mover'}
      danger={false}
      pending={busy || (action === 'move_invoice' && !/^\d{4}-\d{2}$/.test(month))}
      onCancel={onClose}
      onConfirm={run}
    />
  );
};
