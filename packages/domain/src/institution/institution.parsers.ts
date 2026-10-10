import { asIsoString, asString } from '../support/row.js';
import type { Row } from '../support/row.js';
import type { Institution } from './institution.entities.js';

export const parseInstitutionFromDB = (row: Row): Institution => ({
  id: asString(row, 'id'),
  name: asString(row, 'name'),
  country: asString(row, 'country'),
  created_at: asIsoString(row, 'created_at'),
  updated_at: asIsoString(row, 'updated_at'),
});
