import { StatusTag } from './tags.js';
import { isOverdue } from '../domain/cards.js';
import type { InvoiceSummary } from '../domain/cards.js';
import { formatDay } from '../lib/format.js';

/**
 * FIN-511 · A situação da fatura com o complemento que o calendário pede: a
 * aberta diz quando fecha, a fechada que passou do vencimento diz "venceu".
 */
export const InvoiceStatus = ({
  invoice,
  today,
  closesAs = 'fecha em',
}: {
  readonly invoice: InvoiceSummary;
  readonly today: string;
  /** "fecha em 28/10" no cabeçalho da fatura; "fecha 28/10" na tabela de cartões. */
  readonly closesAs?: string;
}): React.ReactElement => {
  if (isOverdue(invoice, today)) {
    return (
      <span className="font-medium text-negative">
        <StatusTag status="fechada" label="venceu" />
      </span>
    );
  }
  if (invoice.status === 'aberta') {
    return (
      <StatusTag
        status="aberta"
        label={`aberta · ${closesAs} ${formatDay(invoice.closing, today)}`}
      />
    );
  }
  return <StatusTag status={invoice.status} />;
};
