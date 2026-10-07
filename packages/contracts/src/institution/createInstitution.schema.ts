import { z } from 'zod';

import { institutionWritableSchema } from './institution.schema.js';

export const createInstitutionSchema = z.object({
  body: institutionWritableSchema,
});

export type CreateInstitutionBody = z.infer<typeof institutionWritableSchema>;
