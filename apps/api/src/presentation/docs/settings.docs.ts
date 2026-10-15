import {
  deleteAllDataResultSchema,
  deleteAllDataSchema,
  errorResponseSchema,
  exportDataSchema,
  getSettingsSchema,
  runBackupSchema,
  settingsSchema,
} from '@patrimonio/contracts';
import { z } from 'zod';

import type { RouteDoc } from './route-doc.js';

const TAG = 'Configurações';

export const SETTINGS_ROUTE_DOCS: readonly RouteDoc[] = [
  {
    method: 'get',
    path: '/settings',
    tag: TAG,
    summary: 'Carteiras, padrões de lançamento e backup',
    request: getSettingsSchema,
    responses: {
      200: {
        description:
          'Uma resposta para a tela, em uma consulta. A carteira ' +
          'traz o que a prende (`blocking`), para a tela explicar o bloqueio antes de ' +
          'a exclusão falhar. ' +
          'Dados de mercado não vêm aqui: têm a rota `/market/health`.',
        schema: settingsSchema,
      },
    },
  },
  {
    method: 'post',
    path: '/backup',
    tag: TAG,
    summary: 'Fazer backup agora',
    request: runBackupSchema,
    responses: {
      202: {
        description:
          'Enfileirado, com retorno imediato. Dois pedidos seguidos no mesmo dia viram ' +
          'um só, pela coalescência da outbox.',
        schema: z.object({
          reference_date: z.string(),
          job_id: z.string(),
          dedupe_key: z.string(),
          already_queued: z.boolean(),
          message: z.string(),
        }),
      },
      400: {
        description: 'O backup está desligado nesta instalação.',
        schema: errorResponseSchema,
      },
    },
  },
  {
    method: 'get',
    path: '/data/export',
    tag: TAG,
    summary: 'Exportar tudo em JSON',
    request: exportDataSchema,
    responses: {
      200: {
        description:
          'Um documento JSON com os cadastros e o livro (instituições, categorias, ' +
          'carteiras, ativos, lançamentos, estratégia, objetivos, preços ' +
          'manuais, proventos anunciados e eventos). Posições e patrimônio diário ' +
          'se recalculam a partir dele. Valores monetários vão como string.',
        schema: z.object({
          exported_at: z.string(),
          format: z.string(),
          tables: z.record(z.string(), z.array(z.unknown())),
        }),
      },
    },
  },
  {
    method: 'delete',
    path: '/data',
    tag: TAG,
    summary: 'Apagar todos os dados',
    request: deleteAllDataSchema,
    responses: {
      200: {
        description:
          'Lançamentos, carteiras, instituições, ativos cadastrados à mão, preços ' +
          'manuais e proventos anunciados foram apagados numa transação. Os dados ' +
          'de mercado (preços de fechamento, índices, catálogo da B3) ficam.',
        schema: deleteAllDataResultSchema,
      },
      400: {
        description: 'A frase de confirmação não confere.',
        schema: errorResponseSchema,
      },
    },
  },
];
