import type { B3Type } from '../asset/asset.entities.js';
import type { DateOnly } from '../support/date_only.js';

/**
 * O lançamento é a única verdade do sistema: posição, saldo, cota e resultado
 * são projeções recalculáveis a partir daqui. É também a única tabela em que
 * uma linha errada muda o patrimônio de todas as datas seguintes.
 */
export const TRANSACTION_KINDS = [
  'buy',
  'sell',
  'payout',
  'deposit',
  'withdrawal',
  'transfer',
  'corporate_event',
] as const;

export const PAYOUT_KINDS = [
  'dividend',
  'jcp',
  'income',
  'interest',
  'amortization',
] as const;

export type TransactionKind = (typeof TRANSACTION_KINDS)[number];
export type PayoutKind = (typeof PAYOUT_KINDS)[number];

export const isTransactionKind = (value: unknown): value is TransactionKind =>
  typeof value === 'string' && (TRANSACTION_KINDS as readonly string[]).includes(value);

export const isPayoutKind = (value: unknown): value is PayoutKind =>
  typeof value === 'string' && (PAYOUT_KINDS as readonly string[]).includes(value);

export type Transaction = {
  readonly id: string;
  readonly kind: TransactionKind;
  readonly trade_date: DateOnly;
  /** O dia em que o dinheiro move. Nunca anterior à operação. */
  readonly settlement_date: DateOnly;
  readonly portfolio_id: string;
  readonly asset_id: string | null;
  readonly institution_id: string;
  readonly quantity: string;
  readonly unit_price: string;
  readonly fees: string;
  readonly gross_amount: string;
  readonly tax_withheld: string;
  /** O que entra ou sai de fato. Negativo sai da carteira. */
  readonly net_amount: string;
  readonly payout_kind: PayoutKind | null;
  /** O líquido previsto, guardado quando o recebido veio diferente. */
  readonly expected_net_amount: string | null;
  readonly record_date: DateOnly | null;
  /** Nulo enquanto o provento está "a receber". */
  readonly confirmed_at: string | null;
  readonly transfer_group_id: string | null;
  readonly event_ratio_from: string | null;
  readonly event_ratio_to: string | null;
  readonly note: string | null;
  readonly idempotency_key: string | null;
  readonly created_at: string;
  readonly updated_at: string;
};

/**
 * A liquidação sugerida pelo tipo de ativo. Ação, FII, ETF e BDR liquidam em
 * D+2; Tesouro em D+1; título bancário no mesmo dia, porque o dinheiro sai da
 * conta na hora da aplicação. A sugestão é editável: corretora e papel fogem
 * da regra mais do que se gostaria.
 */
export const settlementBusinessDays = (
  b3Type: B3Type | null,
  origin: 'market' | 'manual',
): number => {
  if (origin === 'manual') return 0;

  switch (b3Type) {
    case 'treasury':
      return 1;
    case 'cash':
      return 0;
    case 'stock':
    case 'fii':
    case 'etf':
    case 'bdr':
      return 2;
    case null:
      return 2;
  }
};
