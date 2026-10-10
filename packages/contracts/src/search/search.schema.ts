import { PAYOUT_KINDS, TRANSACTION_KINDS } from '@patrimonio/domain';
import { z } from 'zod';

import { b3TypeSchema } from '../asset/asset.schema.js';
import { dateOnly, decimalString, uuid } from '../support/primitives.schema.js';

/**
 * T-09 · A busca global.
 *
 * A paleta encontra quatro coisas: tela, carteira, ativo e lançamento. Só as
 * duas últimas moram no banco — tela e carteira o navegador já tem, e por isso
 * a paleta abre com elas na tela antes de qualquer pedido terminar. Este
 * contrato é a metade que precisa de rede: **ativos** e **lançamentos**.
 *
 * Três regras valem aqui, como em todo contrato desta aplicação:
 *
 * - **Quem acha é quem ordena.** A `api` devolve cada grupo já na ordem em que
 *   deve aparecer — o ativo exato antes do que só contém o texto, o que a
 *   pessoa tem antes do que ela não tem. A paleta não reordena resultado de
 *   banco; ela só decide qual *grupo* vem primeiro.
 * - **O total é o do banco**, não o do que coube. "Mostrando 5 de 24" só é
 *   verdade se os 24 foram contados onde os 24 existem.
 * - **Valor monetário viaja como string**, e ausência é `null`, nunca zero.
 */

/** Quantos resultados cabem por grupo. A paleta é um atalho, não uma listagem. */
export const SEARCH_GROUP_LIMIT_MAX = 10;
export const SEARCH_GROUP_LIMIT_DEFAULT = 5;

export const getSearchSchema = z.object({
  query: z.object({
    /** O texto digitado. Casa com código, nome e observação, sem distinguir maiúscula. */
    q: z.string().trim().min(1).max(80),
    /** Ausente significa todas as carteiras ativas. */
    portfolio_id: uuid.optional(),
    limit: z.coerce
      .number()
      .int()
      .positive()
      .max(SEARCH_GROUP_LIMIT_MAX)
      .default(SEARCH_GROUP_LIMIT_DEFAULT),
  }),
});

export type GetSearchQuery = z.infer<typeof getSearchSchema>['query'];

/**
 * O que a pessoa tem do ativo, no escopo da busca. Nulo quando o ativo está
 * cadastrado mas não há posição — é o caso de quem busca um papel para lançar a
 * primeira compra, e a paleta mostra isso em vez de inventar uma quantidade.
 */
export const searchHoldingSchema = z.object({
  quantity: decimalString,
  market_value: decimalString,
  /** Em quais carteiras, na ordem em que a barra lateral as lista. */
  portfolio_names: z.array(z.string()),
});

export const searchAssetSchema = z.object({
  id: uuid,
  ticker: z.string(),
  name: z.string(),
  b3_type: b3TypeSchema.nullable(),
  holding: searchHoldingSchema.nullable(),
});

export const searchTransactionSchema = z.object({
  id: uuid,
  kind: z.enum(TRANSACTION_KINDS),
  payout_kind: z.enum(PAYOUT_KINDS).nullable(),
  trade_date: dateOnly,
  portfolio_id: uuid,
  portfolio_name: z.string(),
  asset_id: uuid.nullable(),
  ticker: z.string().nullable(),
  /** O nome e o tipo, para o título do ativo seguir a regra do resto da tela. */
  asset_name: z.string().nullable(),
  b3_type: b3TypeSchema.nullable(),
  quantity: decimalString,
  net_amount: decimalString,
  /** Provento ainda "a receber": a paleta o diz, como o extrato diz. */
  pending: z.boolean(),
});

export const searchResourceSchema = z.object({
  query: z.string(),
  assets: z.object({
    total: z.number().int().nonnegative(),
    items: z.array(searchAssetSchema),
  }),
  transactions: z.object({
    total: z.number().int().nonnegative(),
    items: z.array(searchTransactionSchema),
  }),
});

export type SearchHolding = z.infer<typeof searchHoldingSchema>;
export type SearchAsset = z.infer<typeof searchAssetSchema>;
export type SearchTransaction = z.infer<typeof searchTransactionSchema>;
export type SearchResource = z.infer<typeof searchResourceSchema>;
