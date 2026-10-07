import { z } from 'zod';

import { marketAssetSchema } from './asset.schema.js';

/**
 * Ação, FII, ETF, BDR e Tesouro vêm da base de mercado e entram sem cadastro
 * prévio — o primeiro lançamento cria o ativo. Esta rota existe para o caso em
 * que o cadastro vem antes: corrigir nome, classe ou setor sem precisar lançar.
 */
export const createAssetSchema = z.object({
  body: marketAssetSchema.extend({ origin: z.literal('market').default('market') }),
});

export type CreateAssetBody = z.infer<typeof createAssetSchema>['body'];
