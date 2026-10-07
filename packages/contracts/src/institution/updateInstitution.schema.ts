import { z } from 'zod';

import { uuid } from '../support/primitives.schema.js';
import { institutionWritableSchema } from './institution.schema.js';

export const updateInstitutionSchema = z.object({
  params: z.object({ institution_id: uuid }),
  body: institutionWritableSchema.partial(),
});

export type UpdateInstitutionBody = z.infer<typeof updateInstitutionSchema>['body'];
