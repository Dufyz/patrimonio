import { z } from 'zod';

import { uuid } from '../support/primitives.schema.js';

export const listInstitutionsSchema = z.object({
  query: z.object({}).optional(),
});

export const deleteInstitutionSchema = z.object({
  params: z.object({ institution_id: uuid }),
});
