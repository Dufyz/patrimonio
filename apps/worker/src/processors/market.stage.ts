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

        if (typeof assetId === 'string') {
          return deps.usecases.backfillAsset({
            asset_id: assetId,
            ...(isDateOnly(reference) ? { reference_date: reference } : {}),
            ...(typeof job.data.origin_request_id === 'string'
              ? { origin_request_id: job.data.origin_request_id }
              : {}),
          });
        }

        // O payload vem do jsonb da outbox: uma data inválida coletaria o dia
        // errado, e coletar o dia errado não dá erro — dá número errado.
        if (reference !== undefined && !isDateOnly(reference)) {
          return failure(
            new BadRequestError('A coleta de mercado precisa de uma reference_date válida'),
          );
        }

        return deps.usecases.collectMarketData({
          ...(isDateOnly(reference) ? { reference_date: reference } : {}),
          ...(typeof job.data.origin_request_id === 'string'
            ? { origin_request_id: job.data.origin_request_id }
            : {}),
        });
      },
      scheduledEvent: (stageDeps) => ({
        stage: 'market',
        dedupe_key: dedupeKey.market(stageDeps.clock.today()),
        payload: { reference_date: stageDeps.clock.today() },
      }),
    },
    deps,
  );
