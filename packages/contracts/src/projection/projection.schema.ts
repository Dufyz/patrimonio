import { z } from 'zod';

import {
  dateOnly,
  decimalString,
  nonNegativeDecimal,
  positiveDecimal,
  uuid,
} from '../support/primitives.schema.js';

/**
 * PRJ-02/04/06 · A Projeção numa leitura só: o plano (rentabilidade esperada e
 * regras de aporte) e o que o motor calcula com ele, por carteira e no total.
 * A tela não faz conta: lê `series` e `kpis`.
 */
export const projectionMonthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

export const projectionRuleSchema = z.object({
  amount: positiveDecimal,
  from: projectionMonthSchema,
  until: projectionMonthSchema.nullable(),
});

const pointSchema = z.object({
  month: projectionMonthSchema,
  value: decimalString,
  contributions_cumulative: decimalString,
  yield_cumulative: decimalString,
});

const resultSchema = z.object({
  series: z.array(pointSchema),
  kpis: z.object({
    today: decimalString,
    at_horizon: decimalString,
    contributions: decimalString,
    estimated_yield: decimalString,
  }),
});

export const projectionSchema = z.object({
  horizon_months: z.number().int(),
  as_of: dateOnly,
  portfolios: z.array(
    z.object({
      portfolio_id: uuid,
      name: z.string(),
      expected_return_pct: decimalString.nullable(),
      return_assumed_zero: z.boolean(),
      current_value: decimalString.nullable(),
      as_of: dateOnly.nullable(),
      rules: z.array(projectionRuleSchema),
      projection: resultSchema.nullable(),
    }),
  ),
  total: resultSchema.nullable(),
});

export type ProjectionResource = z.infer<typeof projectionSchema>;

export const getProjectionSchema = z.object({
  query: z.object({
    portfolio_id: uuid.optional(),
    horizon: z.coerce
      .number()
      .int()
      .refine((value) => [12, 24, 36, 60].includes(value), 'Horizonte inválido')
      .optional(),
  }),
});

export const putProjectionPlanSchema = z.object({
  params: z.object({ portfolio_id: uuid }),
  body: z.object({
    expected_return_pct: nonNegativeDecimal.nullable(),
    rules: z.array(projectionRuleSchema).max(50),
  }),
});

export type PutProjectionPlanBody = z.infer<typeof putProjectionPlanSchema>['body'];

export const putProjectionPlanResponseSchema = z.object({ message: z.string() });
