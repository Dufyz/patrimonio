import { INSTITUTION_ROLES } from '@patrimonio/domain';
import { z } from 'zod';

import {
  decimalString,
  name,
  nonNegativeDecimal,
  uuid,
} from '../support/primitives.schema.js';

export const institutionRoleSchema = z.enum(INSTITUTION_ROLES);

export const institutionResourceSchema = z.object({
  id: uuid,
  name: z.string(),
  role: institutionRoleSchema,
  fgc_covered: z.boolean(),
  brokerage_per_order: decimalString,
  custody_monthly_fee: decimalString,
  created_at: z.string(),
  updated_at: z.string(),
});

export const institutionWritableSchema = z.object({
  name,
  role: institutionRoleSchema,
  fgc_covered: z.boolean().optional(),
  /** Entra como sugestão no lançamento, e pode ser sobrescrita lá. */
  brokerage_per_order: nonNegativeDecimal.optional(),
  custody_monthly_fee: nonNegativeDecimal.optional(),
});

/**
 * O que a tela de cadastro de título mostra: quanto você já tem neste emissor e
 * quanto do teto do FGC sobrou. Enquanto a marcação na curva não existe, a base
 * é o custo — e o campo `basis` diz isso em vez de deixar a tela adivinhar.
 */
export const fgcExposureResourceSchema = z.object({
  institution_id: uuid,
  institution_name: z.string(),
  fgc_covered: z.boolean(),
  limit_brl: decimalString,
  exposure_brl: decimalString,
  available_brl: decimalString,
  over_limit: z.boolean(),
  basis: z.literal('cost'),
});

export type InstitutionResource = z.infer<typeof institutionResourceSchema>;
export type InstitutionWritable = z.infer<typeof institutionWritableSchema>;
export type FgcExposureResource = z.infer<typeof fgcExposureResourceSchema>;
