import { z } from 'zod';

import { dateOnly, decimalString, uuid } from '../support/primitives.schema.js';

/**
 * Posições encerradas: ativos que a carteira já negociou e hoje não tem mais.
 * Cada linha é a conta fechada do papel — o que entrou, o que saiu, o que
 * rendeu —, e abre a página do ativo, que continua mostrando a vida dele.
 */
export const listClosedPositionsSchema = z.object({
  query: z.object({
    /** Ausente significa todas as carteiras ativas. */
    portfolio_id: uuid.optional(),
    /** Casa com código e com nome do ativo, sem distinguir maiúscula. */
    search: z.string().trim().max(120).optional(),
  }),
});

export type ListClosedPositionsQuery = z.infer<typeof listClosedPositionsSchema>['query'];

export const closedPositionSchema = z.object({
  asset_id: uuid,
  ticker: z.string(),
  name: z.string(),
  category_name: z.string().nullable(),
  /** A classe da categoria: o grupo dela, ou ela mesma quando está solta. */
  class_name: z.string().nullable(),
  color_token: z.string().nullable(),
  first_trade_date: dateOnly,
  closed_on: dateOnly,
  invested: decimalString,
  proceeds: decimalString,
  payouts_received: decimalString,
  /** Resultado de venda segundo o preço médio. Nulo quando não há registro. */
  realized_result: decimalString.nullable(),
  /** Vendido + proventos − investido: o que a carteira ganhou ou perdeu com o papel. */
  total_result: decimalString,
  total_result_ratio: decimalString.nullable(),
});

export const closedPositionsResourceSchema = z.object({
  portfolio_id: uuid.nullable(),
  positions: z.array(closedPositionSchema),
});

export type ClosedPosition = z.infer<typeof closedPositionSchema>;
export type ClosedPositionsResource = z.infer<typeof closedPositionsResourceSchema>;
