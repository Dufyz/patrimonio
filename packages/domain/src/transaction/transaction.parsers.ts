import {
  asDateOnly,
  asDateOnlyOrNull,
  asEnum,
  asEnumOrNull,
  asIsoString,
  asIsoStringOrNull,
  asNumeric,
  asNumericOrNull,
  asString,
  asStringOrNull,
} from '../support/row.js';
import type { Row } from '../support/row.js';
import { PAYOUT_KINDS, TRANSACTION_KINDS } from './transaction.entities.js';
import type { Transaction } from './transaction.entities.js';

export const parseTransactionFromDB = (row: Row): Transaction => ({
  id: asString(row, 'id'),
  kind: asEnum(row, 'kind', TRANSACTION_KINDS),
  trade_date: asDateOnly(row, 'trade_date'),
  settlement_date: asDateOnly(row, 'settlement_date'),
  portfolio_id: asString(row, 'portfolio_id'),
  asset_id: asStringOrNull(row, 'asset_id'),
  institution_id: asString(row, 'institution_id'),
  quantity: asNumeric(row, 'quantity'),
  unit_price: asNumeric(row, 'unit_price'),
  fees: asNumeric(row, 'fees'),
  gross_amount: asNumeric(row, 'gross_amount'),
  tax_withheld: asNumeric(row, 'tax_withheld'),
  net_amount: asNumeric(row, 'net_amount'),
  payout_kind: asEnumOrNull(row, 'payout_kind', PAYOUT_KINDS),
  expected_net_amount: asNumericOrNull(row, 'expected_net_amount'),
  record_date: asDateOnlyOrNull(row, 'record_date'),
  confirmed_at: asIsoStringOrNull(row, 'confirmed_at'),
  event_ratio_from: asNumericOrNull(row, 'event_ratio_from'),
  event_ratio_to: asNumericOrNull(row, 'event_ratio_to'),
  note: asStringOrNull(row, 'note'),
  idempotency_key: asStringOrNull(row, 'idempotency_key'),
  created_at: asIsoString(row, 'created_at'),
  updated_at: asIsoString(row, 'updated_at'),
});
