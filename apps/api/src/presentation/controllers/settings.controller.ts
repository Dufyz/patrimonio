import type { getSettings, requestBackup } from '@patrimonio/application';
import type { RequestHandler } from 'express';

import { sendFailure } from '../middleware/respond.js';

/**
 * A tela de Configurações, numa rota de leitura e uma de ação. A leitura traz as
 * oito seções menos a de dados de mercado, que tem a rota dela (M-16); a ação é
 * o backup imediato. A escrita de cada cadastro — nova carteira, nova categoria,
 * limite de alerta — são as rotas que já existem ou chegam com T-10 e O-01.
 */
export type SettingsDeps = {
  readonly usecases: {
    readonly getSettings: ReturnType<typeof getSettings>;
    readonly requestBackup: ReturnType<typeof requestBackup>;
  };
};

export type SettingsController = {
  readonly settings: RequestHandler;
  readonly backup: RequestHandler;
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
});
