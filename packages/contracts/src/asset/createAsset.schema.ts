import { z } from 'zod';

import { fixedIncomeAssetSchema, marketAssetSchema } from './asset.schema.js';

/**
 * Dois caminhos, um recurso. Ação, FII, ETF, BDR e Tesouro vêm da base de
 * mercado e entram sem cadastro prévio — o primeiro lançamento cria o ativo, e
 * esta rota existe para quem prefere cadastrar antes. Título bancário e crédito
 * privado não têm cotação pública: emissor, indexador, taxa, datas, liquidez e
 * regime de IR são obrigatórios, porque sem eles o papel não tem valor em data
 * nenhuma.
 */
const assetBodySchema = z.discriminatedUnion('origin', [
  marketAssetSchema.extend({ origin: z.literal('market') }),
  fixedIncomeAssetSchema.extend({ origin: z.literal('manual') }),
]);

/**
 * `origin` ausente é `market`. O discriminador do zod é obrigatório por
 * construção, então o corpo passa por um preenchimento antes: sem ele, cadastrar
 * uma ação exigiria declarar a origem que a própria rota já assume, e o caminho
 * comum pagaria pelo caminho raro.
 */
export const createAssetSchema = z.object({
  body: z.preprocess(
    (value) =>
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value) &&
      (value as Record<string, unknown>)['origin'] === undefined
        ? { ...(value as Record<string, unknown>), origin: 'market' }
        : value,
    assetBodySchema,
  ),
});

export type CreateAssetBody = z.infer<typeof createAssetSchema>['body'];
