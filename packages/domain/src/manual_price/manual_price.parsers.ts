import { asDateOnly, asIsoString, asNumeric, asString } from '../support/row.js';
import type { Row } from '../support/row.js';
import type { ManualPrice } from './manual_price.entities.js';

export const parseManualPriceFromDB = (row: Row): ManualPrice => ({
  asset_id: asString(row, 'asset_id'),
  price_date: asDateOnly(row, 'price_date'),
  price: asNumeric(row, 'price'),
  created_at: asIsoString(row, 'created_at'),
  updated_at: asIsoString(row, 'updated_at'),
});
