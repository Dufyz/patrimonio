import { z } from 'zod';

import { categoryWritableSchema } from './category.schema.js';

export const createCategorySchema = z.object({
  body: categoryWritableSchema,
});

export type CreateCategoryBody = z.infer<typeof categoryWritableSchema>;
