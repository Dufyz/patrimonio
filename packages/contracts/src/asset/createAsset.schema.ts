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
export const createAssetSchema = z.object({
  body: z.discriminatedUnion('origin', [
    marketAssetSchema.extend({ origin: z.literal('market') }),
    fixedIncomeAssetSchema.extend({ origin: z.literal('manual') }),
  ]),
});

export type CreateAssetBody = z.infer<typeof createAssetSchema>['body'];
