import { z } from 'zod';

import { uuid } from '../support/primitives.schema.js';

export const institutionResourceSchema = z.object({
  id: uuid,
  name: z.string(),
  country: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type InstitutionResource = z.infer<typeof institutionResourceSchema>;
