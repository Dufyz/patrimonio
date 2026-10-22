import { BadRequestError, lastBusinessDay } from '@patrimonio/application';
import type {
  BackfillAssetResult,
  SyncMarketResult,
} from '@patrimonio/application';
import { dedupeKey, isDateOnly } from '@patrimonio/domain';
import type { OutboxEventDraft } from '@patrimonio/domain';
import { failure } from '@patrimonio/shared';
import type { Worker } from 'bullmq';

import { defineStage } from '../infra/define-stage.js';
import type { StageDeps, StageJobData } from '../infra/define-stage.js';

/**
 * O pedido de sincronização incremental do D-1: o que o agendamento das 09:00 e a
 * retomada na inicialização do worker inserem na outbox. A chave é a do D-1, então
 * dois pedidos pendentes do mesmo dia viram um.
 */
export const incrementalSyncEvent = async (
  deps: Pick<StageDeps, 'unitOfWork' | 'clock'>,
): Promise<OutboxEventDraft> => {
  const reference = await deps.unitOfWork.run((repositories) =>
    lastBusinessDay(repositories, deps.clock.today()),
  );
  if (reference.isFailure()) throw new Error(reference.value.message);

  return {
    stage: 'market',
    dedupe_key: dedupeKey.market(reference.value),
    payload: { reference_date: reference.value, mode: 'incremental' },
  };
};

/**
 * A ingestão de dados de mercado. Duas formas de trabalho na mesma fila:
 *
 * - **Sincronização até o D-1** — o padrão. `mode: 'incremental'` preenche o que
 *   falta; `mode: 'reset'` (o botão "Atualizar agora") refaz tudo. O fechamento
 *   do dia é encadeado pela própria coleta.
 * - **`backfill:<ativo>`** — o histórico de um papel que apareceu pela primeira
 *   vez no livro, da data da primeira compra até hoje.
 *
 * O `asset_id` no payload é o que distingue os dois. A coalescência faz o resto:
 * a chave do backfill é por ativo, então uma rajada de lançamentos do mesmo
 * papel gera um backfill, não cinco.
 */
export const marketStage = (deps: StageDeps): Worker<StageJobData> =>
  defineStage<BackfillAssetResult | SyncMarketResult>(
    {
      stage: 'market',
      run: async (job) => {
        const assetId = job.data['asset_id'];
        const reference = job.data['reference_date'];

        if (typeof assetId === 'string') {
          const backfilled = await deps.usecases.backfillAsset({
            asset_id: assetId,
            ...(isDateOnly(reference) ? { reference_date: reference } : {}),
            ...(typeof job.data.origin_request_id === 'string'
              ? { origin_request_id: job.data.origin_request_id }
              : {}),
          });

          // O histórico desde a estreia roda depois e nunca falha o backfill.
          if (deps.usecases.syncPriceHistory !== undefined) {
            const synced = await deps.usecases.syncPriceHistory({});

            if (synced.isFailure()) {
              deps.logger.warn(
                { err: synced.value.message },
                'histórico de cotações não foi carregado',
              );
            }
          }

          return backfilled;
        }

        // O payload vem do jsonb da outbox: um modo desconhecido não pode virar
        // um reset por engano.
        const mode = job.data['mode'];
        if (mode !== undefined && mode !== 'incremental' && mode !== 'reset') {
          return failure(
            new BadRequestError(`Modo de sincronização inválido: ${String(mode)}`),
          );
        }

        const synced = await deps.usecases.syncMarket({
          mode: mode === 'reset' ? 'reset' : 'incremental',
          ...(typeof job.data.origin_request_id === 'string'
            ? { origin_request_id: job.data.origin_request_id }
            : {}),
        });

        if (synced.isSuccess()) {
          const failed = Object.entries(synced.value.steps).filter(
            ([, step]) => !step.ok,
          );

          if (failed.length > 0) {
            deps.logger.warn(
              { steps: Object.fromEntries(failed) },
              'sincronização terminou com passos falhos',
            );
          }
        }

        return synced;
      },
      scheduledEvent: (stageDeps) => incrementalSyncEvent(stageDeps),
    },
    deps,
  );
