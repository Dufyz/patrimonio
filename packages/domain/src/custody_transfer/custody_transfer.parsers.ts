import { asDateOnly, asIsoString, asString, asStringOrNull } from '../support/row.js';
import type { Row } from '../support/row.js';
import type { CustodyTransfer } from './custody_transfer.entities.js';

export const parseCustodyTransferFromDB = (row: Row): CustodyTransfer => ({
  id: asString(row, 'id'),
  portfolio_id: asString(row, 'portfolio_id'),
  asset_id: asString(row, 'asset_id'),
  from_institution_id: asString(row, 'from_institution_id'),
  to_institution_id: asString(row, 'to_institution_id'),
  transfer_date: asDateOnly(row, 'transfer_date'),
  note: asStringOrNull(row, 'note'),
  created_at: asIsoString(row, 'created_at'),
});
