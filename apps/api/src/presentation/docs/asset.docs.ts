import {
  archiveAssetSchema,
  assetResourceSchema,
  createAssetSchema,
  deleteAssetSchema,
  errorResponseSchema,
  getAssetSchema,
  listAssetsSchema,
  updateAssetSchema,
} from '@patrimonio/contracts';
import { z } from 'zod';

import type { RouteDoc } from './route-doc.js';

const TAG = 'Ativos';

const assetResponse = z.object({
  asset: assetResourceSchema,
  message: z.string(),
});

export const ASSET_ROUTE_DOCS: readonly RouteDoc[] = [
  {
    method: 'get',
    path: '/assets',
    tag: TAG,
    summary: 'Buscar ativo por código ou nome',
    request: listAssetsSchema,
    responses: {
      200: {
        description:
          'O que está no cadastro local. A base da B3 inteira entra com a carga do COTAHIST, em E4.',
        schema: z.object({ assets: z.array(assetResourceSchema) }),
      },
    },
  },
  {
    method: 'post',
    path: '/assets',
    tag: TAG,
    summary: 'Cadastrar ativo listado ou título de renda fixa',
    request: createAssetSchema,
    responses: {
      201: {
        description:
          'Cadastrado. A classe sai da regra automática da categoria quando não vem no corpo; ' +
          'no título de renda fixa, o código interno e o nome exibido são gerados.',
        schema: assetResponse,
      },
      400: {
        description:
          'Título sem emissor, com vencimento antes da aplicação, com liquidez D+n sem o número ' +
          'de dias, ou isento declarado com tabela regressiva.',
        schema: errorResponseSchema,
      },
      409: {
        description: 'Já existe ativo com esse código.',
        schema: errorResponseSchema,
      },
    },
  },
  {
    method: 'get',
    path: '/assets/:asset_id',
    tag: TAG,
    summary: 'Os dados do ativo',
    request: getAssetSchema,
    responses: {
      200: {
        description: 'O ativo existe.',
        schema: z.object({ asset: assetResourceSchema }),
      },
      404: { description: 'Não existe ativo com esse id.', schema: errorResponseSchema },
    },
  },
  {
    method: 'patch',
    path: '/assets/:asset_id',
    tag: TAG,
    summary: 'Editar ativo; trocar a categoria reclassifica o histórico',
    request: updateAssetSchema,
    responses: {
      200: {
        description:
          'Atualizado. Trocar a categoria enfileira recálculo de toda carteira que tem o ativo.',
        schema: assetResponse,
      },
      404: { description: 'Não existe ativo com esse id.', schema: errorResponseSchema },
    },
  },
  {
    method: 'post',
    path: '/assets/:asset_id/archive',
    tag: TAG,
    summary: 'Arquivar ativo com posição zerada',
    request: archiveAssetSchema,
    responses: {
      200: {
        description: 'Arquivado: some da busca e mantém o histórico.',
        schema: assetResponse,
      },
      404: { description: 'Não existe ativo com esse id.', schema: errorResponseSchema },
      409: {
        description: 'A posição ainda está aberta: arquivar exige posição zerada.',
        schema: errorResponseSchema,
      },
    },
  },
  {
    method: 'delete',
    path: '/assets/:asset_id',
    tag: TAG,
    summary: 'Excluir ativo sem histórico',
    request: deleteAssetSchema,
    responses: {
      200: {
        description: 'Excluído: o código volta a aparecer apenas na busca da base da B3.',
        schema: z.object({ result: z.object({ id: z.string() }), message: z.string() }),
      },
      404: { description: 'Não existe ativo com esse id.', schema: errorResponseSchema },
      409: {
        description:
          'Há lançamentos usando o ativo: a mensagem traz a contagem e oferece arquivar.',
        schema: errorResponseSchema,
      },
    },
  },
];
