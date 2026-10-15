import { institutionResourceSchema, listInstitutionsSchema } from '@patrimonio/contracts';
import { z } from 'zod';

import type { RouteDoc } from './route-doc.js';

const TAG = 'Instituições';

export const INSTITUTION_ROUTE_DOCS: readonly RouteDoc[] = [
  {
    method: 'get',
    path: '/institutions',
    tag: TAG,
    summary: 'Catálogo de instituições',
    request: listInstitutionsSchema,
    responses: {
      200: {
        description:
          'O catálogo carregado por `pnpm seed:institutions`, usado na busca do lançamento.',
        schema: z.object({ institutions: z.array(institutionResourceSchema) }),
      },
    },
  },
];
