import { z } from 'zod';

import { name, uuid } from '../support/primitives.schema.js';

/**
 * Token do design system, nunca hexadecimal: a cor de uma classe precisa ser a
 * mesma na tabela, no gráfico e na barra de alocação, nos dois temas.
 */
const colorToken = z
  .string()
  .regex(/^[a-z][a-z0-9]*(\.[a-z0-9-]+)+$/, 'use um token de cor, como class.acoes');

const categoryWritableSchema = z.object({
  name,
  color_token: colorToken,
  /** Ausente é uma classe (raiz); presente é uma categoria dentro de uma classe. */
  parent_id: uuid.nullable(),
  auto_rule: z.record(z.string(), z.unknown()).nullable(),
});

export const createCategorySchema = z.object({
  body: categoryWritableSchema.partial().required({ name: true, color_token: true }),
});

/** Edição parcial. `parent_id` é como a categoria muda de classe. */
export const updateCategorySchema = z.object({
  params: z.object({ category_id: uuid }),
  body: categoryWritableSchema.partial(),
});

export const deleteCategorySchema = z.object({
  params: z.object({ category_id: uuid }),
});

export type CreateCategoryBody = z.infer<typeof createCategorySchema>['body'];
export type UpdateCategoryBody = z.infer<typeof updateCategorySchema>['body'];
