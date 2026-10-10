import { z } from 'zod';

import { name, uuid } from '../support/primitives.schema.js';

/** ISO 3166-1 alpha-2: `BR`, `US`. Quem digita pode usar minúsculas. */
export const countrySchema = z
  .string()
  .regex(/^[A-Za-z]{2}$/, 'informe o país com duas letras, como BR ou US')
  .transform((value) => value.toUpperCase());

export const institutionResourceSchema = z.object({
  id: uuid,
  name: z.string(),
  country: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const institutionWritableSchema = z.object({
  name,
  /** Ausente é `BR`: as instituições brasileiras vêm do catálogo. */
  country: countrySchema.optional(),
});

export type InstitutionResource = z.infer<typeof institutionResourceSchema>;
export type InstitutionWritable = z.infer<typeof institutionWritableSchema>;
