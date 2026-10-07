import {
  asInteger,
  asIsoString,
  asJsonOrNull,
  asString,
  asStringOrNull,
} from '../support/row.js';
import type { Row } from '../support/row.js';
import type { Category } from './category.entities.js';

export const parseCategoryFromDB = (row: Row): Category => ({
  id: asString(row, 'id'),
  parent_id: asStringOrNull(row, 'parent_id'),
  name: asString(row, 'name'),
  color_token: asString(row, 'color_token'),
  auto_rule: asJsonOrNull(row, 'auto_rule'),
  sort_order: asInteger(row, 'sort_order'),
  created_at: asIsoString(row, 'created_at'),
  updated_at: asIsoString(row, 'updated_at'),
});
