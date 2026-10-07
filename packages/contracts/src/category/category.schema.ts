import { isColorToken } from '@patrimonio/domain';
import { z } from 'zod';

import { name, uuid } from '../support/primitives.schema.js';

/**
 * A cor vem do design system, não do seletor de cor: `class.fii`, nunca
 * `#2563eb`. É o que garante que a mesma classe tenha a mesma cor na tabela, no
 * gráfico e na barra de alocação, nos dois temas.
 */
export const colorToken = z
  .string()
  .refine(isColorToken, 'use um token do design system, como class.fii');

/** As chaves que uma regra automática pode olhar são fechadas de propósito. */
export const autoRuleSchema = z
  .object({
    b3_type: z.string().optional(),
    indexer: z.string().optional(),
    origin: z.string().optional(),
    sector: z.string().optional(),
  })
  .refine((rule) => Object.keys(rule).length > 0, 'a regra precisa de ao menos uma condição');

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

export const categoryWritableSchema = z.object({
  name,
  /** Nulo é grupo; preenchido é categoria dentro do grupo. Só dois níveis. */
  parent_id: uuid.nullable().optional(),
  color_token: colorToken,
  auto_rule: autoRuleSchema.nullable().optional(),
  sort_order: z.number().int().optional(),
});

export type CategoryResource = z.infer<typeof categoryResourceSchema>;
export type CategoryWritable = z.infer<typeof categoryWritableSchema>;
