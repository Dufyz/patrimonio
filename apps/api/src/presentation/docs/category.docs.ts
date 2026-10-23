import {
  categoryResourceSchema,
  createCategorySchema,
  deleteCategorySchema,
  errorResponseSchema,
  listCategoriesSchema,
  updateCategorySchema,
} from '@patrimonio/contracts';
import { z } from 'zod';

import type { RouteDoc } from './route-doc.js';

const TAG = 'Categorias';

const written = z.object({ category: categoryResourceSchema, message: z.string() });

export const CATEGORY_ROUTE_DOCS: readonly RouteDoc[] = [
  {
    method: 'get',
    path: '/categories',
    tag: TAG,
    summary: 'Categorias e classes, na ordem de exibição',
    request: listCategoriesSchema,
    responses: {
      200: {
        description:
          'O catálogo da plataforma mais o que a pessoa criou. Classe é a categoria de primeiro nível; as demais ficam dentro de uma classe.',
        schema: z.object({ categories: z.array(categoryResourceSchema) }),
      },
    },
  },
  {
    method: 'post',
    path: '/categories',
    tag: TAG,
    summary: 'Criar classe (sem pai) ou categoria dentro de uma classe',
    request: createCategorySchema,
    responses: {
      201: { description: 'Criada.', schema: written },
      400: {
        description: 'Corpo inválido, ou três níveis.',
        schema: errorResponseSchema,
      },
      409: { description: 'Nome repetido no mesmo nível.', schema: errorResponseSchema },
    },
  },
  {
    method: 'patch',
    path: '/categories/:category_id',
    tag: TAG,
    summary: 'Renomear, recolorir ou mover a categoria de classe',
    request: updateCategorySchema,
    responses: {
      200: { description: 'Atualizada. O id não muda.', schema: written },
      404: { description: 'Categoria não encontrada.', schema: errorResponseSchema },
      409: {
        description: 'Nome repetido, ou alvo de estratégia duplicado pelo movimento.',
        schema: errorResponseSchema,
      },
    },
  },
  {
    method: 'delete',
    path: '/categories/:category_id',
    tag: TAG,
    summary: 'Excluir classe ou categoria sem uso',
    request: deleteCategorySchema,
    responses: {
      200: {
        description: 'Excluída.',
        schema: z.object({ category: z.object({ id: z.string() }), message: z.string() }),
      },
      409: {
        description: 'Tem categorias dentro, ativos ou alvo de estratégia.',
        schema: errorResponseSchema,
      },
    },
  },
];
