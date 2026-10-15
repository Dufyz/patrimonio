import { BadRequestError } from '@patrimonio/application';
import type {
  BackfillAssetResult,
  CollectMarketDataResult,
} from '@patrimonio/application';
import { dedupeKey, isDateOnly } from '@patrimonio/domain';
import { failure } from '@patrimonio/shared';
import type { Worker } from 'bullmq';

import { defineStage } from '../infra/define-stage.js';
import type { StageDeps, StageJobData } from '../infra/define-stage.js';

/**
 * A ingestão de dados de mercado. Duas formas de trabalho na mesma fila, porque
 * as duas falam com as mesmas fontes e consomem a mesma cota:
 *
 * - **`market:<data>`** — a coleta do dia: preços, índices e Tesouro, e o
 *   fechamento encadeado em seguida.
 * - **`backfill:<ativo>`** — o histórico de um papel que apareceu pela primeira
 *   vez no livro, da data da primeira compra até hoje.
 *
 * Depois da coleta do dia, o estágio tenta recarregar o catálogo de papéis.
 *
 * O `asset_id` no payload é o que distingue os dois. A coalescência faz o resto:
 * a chave do backfill é por ativo, então uma rajada de lançamentos do mesmo
 * papel gera um backfill, não cinco.
 *
 * A concorrência da fila é 2, mas nenhum dos dois caminhos paraleliza chamadas
 * dentro de si: o plano gratuito da brapi permite uma requisição simultânea, e
 * paralelizar ali só produziria 429.
 */
export const marketStage = (deps: StageDeps): Worker<StageJobData> =>
  defineStage<BackfillAssetResult | CollectMarketDataResult>(
    {
      stage: 'market',
      run: async (job) => {
        const assetId = job.data['asset_id'];
        const reference = job.data['reference_date'];

        // Histórico desde a estreia: roda depois do trabalho principal e nunca o
        // falha. O papel pendente é carregado uma vez e marcado; as rodadas
        // seguintes saem cedo porque a fila está vazia.
        const syncHistory = async (): Promise<void> => {
          if (deps.usecases.syncPriceHistory === undefined) return;

          const synced = await deps.usecases.syncPriceHistory({});

          if (synced.isFailure()) {
            deps.logger.warn(
              { err: synced.value.message },
              'histórico de cotações não foi carregado',
            );
          } else if (synced.value.synced.length > 0) {
            deps.logger.info(synced.value, 'histórico de cotações carregado');
          }
        };

        if (typeof assetId === 'string') {
          const backfilled = await deps.usecases.backfillAsset({
            asset_id: assetId,
            ...(isDateOnly(reference) ? { reference_date: reference } : {}),
            ...(typeof job.data.origin_request_id === 'string'
              ? { origin_request_id: job.data.origin_request_id }
              : {}),
          });

          await syncHistory();
          return backfilled;
        }

        // O payload vem do jsonb da outbox: uma data inválida coletaria o dia
        // errado, e coletar o dia errado não dá erro — dá número errado.
        if (reference !== undefined && !isDateOnly(reference)) {
          return failure(
            new BadRequestError(
              'A coleta de mercado precisa de uma reference_date válida',
            ),
          );
        }

        const collected = await deps.usecases.collectMarketData({
          ...(isDateOnly(reference) ? { reference_date: reference } : {}),
          ...(typeof job.data.origin_request_id === 'string'
            ? { origin_request_id: job.data.origin_request_id }
            : {}),
        });

        // O catálogo de papéis se recarrega aqui, e não numa fila própria: o
        // caso de uso sai cedo enquanto a última carga é recente, então na
        // prática roda uma vez por mês. Falhar nele não falha a coleta do dia —
        // o preço de hoje não depende de saber que existe um papel novo.
        if (deps.usecases.refreshInstrumentCatalog !== undefined) {
          const refreshed = await deps.usecases.refreshInstrumentCatalog({});

          if (refreshed.isFailure()) {
            deps.logger.warn(
              { err: refreshed.value.message },
              'catálogo de papéis não foi recarregado',
            );
          }
        }

        await syncHistory();

        return collected;
      },
      scheduledEvent: (stageDeps) => ({
        stage: 'market',
        dedupe_key: dedupeKey.market(stageDeps.clock.today()),
        payload: { reference_date: stageDeps.clock.today() },
      }),
    },
    deps,
  );
