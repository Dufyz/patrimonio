import {
  errorResponseSchema,
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
    summary:
      'Carteiras, alertas, categorias, instituições, padrões de lançamento e backup',
    request: getSettingsSchema,
    responses: {
      200: {
        description:
          'Uma resposta para a tela, em uma consulta. Carteira, categoria e instituição ' +
          'trazem o que as prende (`blocking`), para a tela explicar o bloqueio antes de ' +
          'a exclusão falhar. O grupo de categorias soma ativos e carteiras distintas das ' +
          'categorias dentro dele. ' +
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
];
