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

const categoryResponse = z.object({
  category: categoryResourceSchema,
  message: z.string(),
});

export const CATEGORY_ROUTE_DOCS: readonly RouteDoc[] = [
  {
    method: 'get',
    path: '/categories',
    tag: TAG,
    summary: 'Grupos e categorias, na ordem de exibição',
    request: listCategoriesSchema,
    responses: {
      200: {
        description: 'Dois níveis: o grupo é a soma das categorias dentro dele.',
        schema: z.object({ categories: z.array(categoryResourceSchema) }),
      },
    },
  },
  {
    method: 'post',
    path: '/categories',
    tag: TAG,
    summary: 'Criar grupo ou categoria',
    request: createCategorySchema,
    responses: {
      201: { description: 'Categoria criada.', schema: categoryResponse },
      400: {
        description:
          'Cor fora do design system, ou pai que já está dentro de um grupo: só há dois níveis.',
        schema: errorResponseSchema,
      },
      409: {
        description: 'Já existe categoria com esse nome no mesmo nível.',
        schema: errorResponseSchema,
      },
    },
  },
  {
    method: 'patch',
    path: '/categories/:category_id',
    tag: TAG,
    summary: 'Editar categoria, cor e regra automática',
    request: updateCategorySchema,
    responses: {
      200: {
        description:
          'Renomear mantém os ativos e lançamentos ligados: o vínculo é por id.',
        schema: categoryResponse,
      },
      400: {
        description: 'A mudança criaria um terceiro nível.',
        schema: errorResponseSchema,
      },
      404: {
        description: 'Não existe categoria com esse id.',
        schema: errorResponseSchema,
      },
    },
  },
  {
    method: 'delete',
    path: '/categories/:category_id',
    tag: TAG,
    summary: 'Excluir categoria sem uso',
    request: deleteCategorySchema,
    responses: {
      200: {
        description: 'Excluída.',
        schema: z.object({ result: z.object({ id: z.string() }), message: z.string() }),
      },
      404: {
        description: 'Não existe categoria com esse id.',
        schema: errorResponseSchema,
      },
      409: {
        description:
          'Ainda classifica ativo, aparece em alvo de estratégia ou tem categorias dentro dela.',
        schema: errorResponseSchema,
      },
    },
  },
];
