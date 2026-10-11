import { categoryResourceSchema, listCategoriesSchema } from '@patrimonio/contracts';
import { z } from 'zod';

import type { RouteDoc } from './route-doc.js';

const TAG = 'Categorias';

export const CATEGORY_ROUTE_DOCS: readonly RouteDoc[] = [
  {
    method: 'get',
    path: '/categories',
    tag: TAG,
    summary: 'Catálogo de categorias, na ordem de exibição',
    request: listCategoriesSchema,
    responses: {
      200: {
        description:
          'O catálogo da plataforma, carregado pela migration 029: a pessoa escolhe a categoria do ativo, mas não cria nem edita categoria.',
        schema: z.object({ categories: z.array(categoryResourceSchema) }),
      },
    },
  },
];
