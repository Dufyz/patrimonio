import { z } from 'zod';

import { uuid } from '../support/primitives.schema.js';
import { assetWritableSchema } from './asset.schema.js';

export const updateAssetSchema = z.object({
  params: z.object({ asset_id: uuid }),
  body: assetWritableSchema,
});

export type UpdateAssetBody = z.infer<typeof updateAssetSchema>['body'];
