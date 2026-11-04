import type {
  deleteAllData,
  exportData,
  getSettings,
  requestBackup,
} from '@patrimonio/application';
import type { RequestHandler } from 'express';

import { sendFailure } from '../middleware/respond.js';

/**
 * A tela de Configurações, numa rota de leitura e uma de ação. A leitura traz as
 * seções menos a de dados de mercado, que tem a rota dela (M-16); a ação é
 * o backup imediato. A escrita de cada cadastro são as rotas que já existem
 * ou chegam com T-10 e O-01.
 */
export type SettingsDeps = {
  readonly usecases: {
    readonly getSettings: ReturnType<typeof getSettings>;
    readonly requestBackup: ReturnType<typeof requestBackup>;
    readonly exportData: ReturnType<typeof exportData>;
    readonly deleteAllData: ReturnType<typeof deleteAllData>;
  };
};

export type SettingsController = {
  readonly settings: RequestHandler;
  readonly backup: RequestHandler;
  readonly exportAll: RequestHandler;
  readonly deleteAll: RequestHandler;
};

export const createSettingsController = (deps: SettingsDeps): SettingsController => ({
  settings: async (request, response) => {
    const result = await deps.usecases.getSettings();

    if (result.isFailure()) {
      sendFailure(request, response, result.value);
      return;
    }

    response.json(result.value);
  },

  backup: async (request, response) => {
    const result = await deps.usecases.requestBackup({
      ...(request.requestId === undefined
        ? {}
        : { origin_request_id: request.requestId }),
    });

    if (result.isFailure()) {
      sendFailure(request, response, result.value);
      return;
    }

    response.status(202).json({
      reference_date: result.value.reference_date,
      job_id: result.value.queued.id,
      dedupe_key: result.value.queued.dedupe_key,
      already_queued: result.value.queued.already_queued,
      message: 'Backup enfileirado.',
    });
  },

  // O documento já é JSON em texto, montado no banco: reserializar passaria o
  // `numeric` por `double`. Sai como anexo, para o navegador baixar.
  exportAll: async (request, response) => {
    const result = await deps.usecases.exportData();

    if (result.isFailure()) {
      sendFailure(request, response, result.value);
      return;
    }

    response
      .type('application/json')
      .attachment('patrimonio-export.json')
      .send(result.value.json);
  },

  deleteAll: async (request, response) => {
    const result = await deps.usecases.deleteAllData();

    if (result.isFailure()) {
      sendFailure(request, response, result.value);
      return;
    }

    response.json({
      deleted_transactions: result.value.transactions,
      deleted_portfolios: result.value.portfolios,
      deleted_assets: result.value.assets,
      deleted_institutions: result.value.institutions,
      message: 'Todos os dados foram apagados.',
    });
  },
});
