import { z } from 'zod';

import { uuid } from '../support/primitives.schema.js';

export const listCategoriesSchema = z.object({
  query: z.object({}).optional(),
});

export const deleteCategorySchema = z.object({
  params: z.object({ category_id: uuid }),
});
