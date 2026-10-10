import {
  createInstitutionSchema,
  deleteInstitutionSchema,
  errorResponseSchema,
  institutionResourceSchema,
  listInstitutionsSchema,
  updateInstitutionSchema,
} from '@patrimonio/contracts';
import { z } from 'zod';

import type { RouteDoc } from './route-doc.js';

const TAG = 'Instituições';

const institutionResponse = z.object({
  institution: institutionResourceSchema,
  message: z.string(),
});

export const INSTITUTION_ROUTE_DOCS: readonly RouteDoc[] = [
  {
    method: 'get',
    path: '/institutions',
    tag: TAG,
    summary: 'Instituições cadastradas',
    request: listInstitutionsSchema,
    responses: {
      200: {
        description: 'A lista usada nos seletores de lançamento.',
        schema: z.object({ institutions: z.array(institutionResourceSchema) }),
      },
    },
  },
  {
    method: 'post',
    path: '/institutions',
    tag: TAG,
    summary: 'Cadastrar instituição',
    request: createInstitutionSchema,
    responses: {
      201: { description: 'Instituição criada.', schema: institutionResponse },
      409: {
        description: 'Já existe instituição com esse nome.',
        schema: errorResponseSchema,
      },
    },
  },
  {
    method: 'patch',
    path: '/institutions/:institution_id',
    tag: TAG,
    summary: 'Editar instituição, inclusive corretagem e custódia',
    request: updateInstitutionSchema,
    responses: {
      200: { description: 'Instituição atualizada.', schema: institutionResponse },
      404: {
        description: 'Não existe instituição com esse id.',
        schema: errorResponseSchema,
      },
    },
  },
  {
    method: 'delete',
    path: '/institutions/:institution_id',
    tag: TAG,
    summary: 'Excluir instituição sem histórico',
    request: deleteInstitutionSchema,
    responses: {
      200: {
        description: 'Excluída.',
        schema: z.object({ result: z.object({ id: z.string() }), message: z.string() }),
      },
      404: {
        description: 'Não existe instituição com esse id.',
        schema: errorResponseSchema,
      },
      409: {
        description:
          'Há lançamentos ou ativos ligados a ela: a mensagem traz a contagem do que impede.',
        schema: errorResponseSchema,
      },
    },
  },
];
