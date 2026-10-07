import {
  asDateOnly,
  asEnum,
  asIsoString,
  asNumeric,
  asString,
  asStringOrNull,
} from '../support/row.js';
import type { Row } from '../support/row.js';
import { PAYOUT_KINDS } from '../transaction/transaction.entities.js';
import type { PayoutDismissal } from './payout_dismissal.entities.js';

export const parsePayoutDismissalFromDB = (row: Row): PayoutDismissal => ({
  id: asString(row, 'id'),
  portfolio_id: asString(row, 'portfolio_id'),
  asset_id: asStringOrNull(row, 'asset_id'),
  payout_kind: asEnum(row, 'payout_kind', PAYOUT_KINDS),
  record_date: asDateOnly(row, 'record_date'),
  payment_date: asDateOnly(row, 'payment_date'),
  expected_net_amount: asNumeric(row, 'expected_net_amount'),
  reason: asString(row, 'reason'),
  created_at: asIsoString(row, 'created_at'),
});
