import {
  ASSET_ORIGINS,
  B3_TYPES,
  INDEXERS,
  LIQUIDITY_KINDS,
  PRICE_SOURCES,
  REDEMPTION_RULES,
  TAX_REGIMES,
} from '@patrimonio/domain';
import { z } from 'zod';

import {
  dateOnly,
  decimalString,
  name,
  nonNegativeDecimal,
  uuid,
} from '../support/primitives.schema.js';

export const assetOriginSchema = z.enum(ASSET_ORIGINS);
export const b3TypeSchema = z.enum(B3_TYPES);
export const indexerSchema = z.enum(INDEXERS);
export const liquidityKindSchema = z.enum(LIQUIDITY_KINDS);
export const priceSourceSchema = z.enum(PRICE_SOURCES);
export const taxRegimeSchema = z.enum(TAX_REGIMES);
export const redemptionRuleSchema = z.enum(REDEMPTION_RULES);

export const assetResourceSchema = z.object({
  id: uuid,
  ticker: z.string(),
  name: z.string(),
  origin: assetOriginSchema,
  b3_type: b3TypeSchema.nullable(),
  category_id: uuid.nullable(),
  sector: z.string().nullable(),
  price_source: priceSourceSchema,
  issuer_id: uuid.nullable(),
  indexer: indexerSchema.nullable(),
  rate: decimalString.nullable(),
  issued_at: dateOnly.nullable(),
  maturity_date: dateOnly.nullable(),
  liquidity: liquidityKindSchema.nullable(),
  liquidity_days: z.number().int().nullable(),
  tax_regime: taxRegimeSchema.nullable(),
  redemption_rule: redemptionRuleSchema.nullable(),
  lot_term_months: z.number().int().nullable(),
  archived_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

/** O que o ativo listado precisa: código, nome e tipo. O resto é sugestão. */
export const marketAssetSchema = z.object({
  ticker: z.string().trim().min(1).max(20).toUpperCase(),
  name,
  b3_type: b3TypeSchema.optional(),
  category_id: uuid.nullable().optional(),
  sector: z.string().trim().max(120).nullable().optional(),
  price_source: priceSourceSchema.optional(),
  /** Tesouro tem vencimento e preço de mercado ao mesmo tempo. */
  maturity_date: dateOnly.nullable().optional(),
  indexer: indexerSchema.nullable().optional(),
  rate: decimalString.nullable().optional(),
});

/**
 * Título bancário e crédito privado não têm cotação pública: o preço é marcado
 * na curva pela taxa, e por isso emissor, indexador, taxa, datas, liquidez e
 * regime de IR são obrigatórios no cadastro.
 */
export const fixedIncomeAssetSchema = z.object({
  kind: z.enum(['cdb', 'lci', 'lca', 'cri', 'cra', 'debenture', 'outro']),
  issuer_id: uuid,
  indexer: indexerSchema,
  rate: nonNegativeDecimal,
  issued_at: dateOnly,
  /** Ausente só na caixinha, que não tem vencimento próprio. */
  maturity_date: dateOnly.optional(),
  /** Presente só na caixinha: ativo com lotes e a regra de consumo no resgate. */
  redemption_rule: redemptionRuleSchema.optional(),
  /** Caixinha que não vence mas cujos lotes vencem: prazo padrão do aporte, em meses. */
  lot_term_months: z.number().int().positive().optional(),
  liquidity: liquidityKindSchema,
  liquidity_days: z.number().int().positive().optional(),
  tax_regime: taxRegimeSchema,
  /** Gerado automaticamente quando não vem, e editável depois. */
  name: name.optional(),
  category_id: uuid.nullable().optional(),
});

export const assetWritableSchema = z.object({
  // Folga além dos 20 de hoje: o código gerado de um título passa de 20 (CDB-NUPAGAME--CAIXINHA tem 22).
  ticker: z.string().trim().min(1).max(60).optional(),
  name: name.optional(),
  b3_type: b3TypeSchema.nullable().optional(),
  category_id: uuid.nullable().optional(),
  sector: z.string().trim().max(120).nullable().optional(),
  price_source: priceSourceSchema.optional(),
  issuer_id: uuid.nullable().optional(),
  indexer: indexerSchema.nullable().optional(),
  rate: decimalString.nullable().optional(),
  issued_at: dateOnly.nullable().optional(),
  maturity_date: dateOnly.nullable().optional(),
  liquidity: liquidityKindSchema.nullable().optional(),
  liquidity_days: z.number().int().positive().nullable().optional(),
  tax_regime: taxRegimeSchema.nullable().optional(),
  redemption_rule: redemptionRuleSchema.nullable().optional(),
  lot_term_months: z.number().int().positive().nullable().optional(),
});

export type AssetResource = z.infer<typeof assetResourceSchema>;
export type MarketAssetBody = z.infer<typeof marketAssetSchema>;
export type FixedIncomeAssetBody = z.infer<typeof fixedIncomeAssetSchema>;
export type AssetWritable = z.infer<typeof assetWritableSchema>;
