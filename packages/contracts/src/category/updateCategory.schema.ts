import { z } from 'zod';

import { uuid } from '../support/primitives.schema.js';
import { categoryWritableSchema } from './category.schema.js';

export const updateCategorySchema = z.object({
  params: z.object({ category_id: uuid }),
  body: categoryWritableSchema.partial(),
});

export type UpdateCategoryBody = z.infer<typeof updateCategorySchema>['body'];
