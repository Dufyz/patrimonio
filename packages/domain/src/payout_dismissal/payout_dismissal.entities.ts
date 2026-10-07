import type { PayoutKind } from '../transaction/transaction.entities.js';
import type { DateOnly } from '../support/date_only.js';

/**
 * O provento que não foi pago. Ele sai do livro — porque não existiu —, mas o
 * motivo fica: sem este registro, um provento que some não tem explicação seis
 * meses depois, e a dúvida volta toda vez que a fonte anunciar o mesmo
 * pagamento.
 */
export type PayoutDismissal = {
  readonly id: string;
  readonly portfolio_id: string;
  readonly asset_id: string | null;
  readonly payout_kind: PayoutKind;
  readonly record_date: DateOnly;
  readonly payment_date: DateOnly;
  readonly expected_net_amount: string;
  readonly reason: string;
  readonly created_at: string;
};
