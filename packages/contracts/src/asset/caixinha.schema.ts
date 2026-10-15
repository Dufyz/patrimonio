import { REDEMPTION_RULES } from '@patrimonio/domain';
import { z } from 'zod';

import {
  dateOnly,
  decimalString,
  nonNegativeDecimal,
  uuid,
} from '../support/primitives.schema.js';

const scope = z.object({ portfolio_id: uuid, asset_id: uuid });

export const redemptionRuleResourceSchema = z.enum(REDEMPTION_RULES);

export const caixinhaLotSchema = z.object({
  id: uuid,
  /** Data da aplicação: é dela que contam o rendimento e a alíquota do IR. */
  trade_date: dateOnly,
  /** Nulo é lote sem vencimento. */
  maturity_date: dateOnly.nullable(),
  /** Já venceu na data, ou não tem vencimento. */
  settlement_date: z.string(),
  settled: z.boolean(),
  matured: z.boolean(),
  /** Dá para resgatar na data: venceu, ou a caixinha tem liquidez diária. */
  redeemable: z.boolean(),
  principal: decimalString,
  remaining: decimalString,
  gross_value: decimalString,
  accrued_interest: decimalString,
  elapsed_days: z.number().int(),
  tax_rate: decimalString,
  tax_due: decimalString,
  net_value: decimalString,
});

/** Os lotes da caixinha numa data: cada aplicação com valor e IR do próprio prazo. */
export const getCaixinhaSchema = z.object({
  params: scope,
  query: z.object({ as_of: dateOnly.optional() }),
});

export const caixinhaResponseSchema = z.object({
  as_of: dateOnly,
  redemption_rule: redemptionRuleResourceSchema,
  lots: z.array(caixinhaLotSchema),
  principal: decimalString,
  gross_value: decimalString,
  tax_due: decimalString,
  net_value: decimalString,
  /** Algum dia útil sem índice publicado: o valor é o melhor disponível. */
  incomplete: z.boolean(),
});

const redemptionBody = z.object({
  trade_date: dateOnly,
  /** Bruto a resgatar, antes do IR: é o que a caixinha debita. */
  amount: nonNegativeDecimal,
});

export const previewCaixinhaRedemptionSchema = z.object({
  params: scope,
  body: redemptionBody,
});

export const redeemCaixinhaSchema = z.object({
  params: scope,
  body: redemptionBody,
});

export const caixinhaSliceSchema = z.object({
  lot_id: uuid,
  trade_date: dateOnly,
  principal: decimalString,
  gross_value: decimalString,
  tax_rate: decimalString,
  tax_due: decimalString,
  net_value: decimalString,
  closes_lot: z.boolean(),
});

export const caixinhaRedemptionPlanSchema = z.object({
  redemption_rule: redemptionRuleResourceSchema,
  slices: z.array(caixinhaSliceSchema),
  gross_value: decimalString,
  tax_due: decimalString,
  net_value: decimalString,
  insufficient: z.boolean(),
  available_gross: decimalString,
  incomplete: z.boolean(),
});

export type GetCaixinhaResponse = z.infer<typeof caixinhaResponseSchema>;
export type CaixinhaRedemptionPlan = z.infer<typeof caixinhaRedemptionPlanSchema>;
export type CaixinhaRedemptionBody = z.infer<typeof redeemCaixinhaSchema>['body'];
