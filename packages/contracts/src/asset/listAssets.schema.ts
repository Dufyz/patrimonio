import { z } from 'zod';

import { uuid } from '../support/primitives.schema.js';
import { assetOriginSchema } from './asset.schema.js';

export const listAssetsSchema = z.object({
  query: z.object({
    /**
     * Busca por código ou nome. Enquanto a base da B3 não é carregada (E4), a
     * busca encontra o que já existe no cadastro local.
     */
    search: z.string().trim().max(60).optional(),
    origin: assetOriginSchema.optional(),
    include_archived: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
  }),
});

export const getAssetSchema = z.object({
  params: z.object({ asset_id: uuid }),
});

export const archiveAssetSchema = z.object({
  params: z.object({ asset_id: uuid }),
  body: z.object({ archived: z.boolean() }),
});

export const deleteAssetSchema = z.object({
  params: z.object({ asset_id: uuid }),
});
