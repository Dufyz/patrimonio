import { z } from 'zod';

import { uuid } from '../support/primitives.schema.js';

export const categoryResourceSchema = z.object({
  id: uuid,
  parent_id: uuid.nullable(),
  name: z.string(),
  color_token: z.string(),
  auto_rule: z.record(z.string(), z.unknown()).nullable(),
  sort_order: z.number().int(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type CategoryResource = z.infer<typeof categoryResourceSchema>;
