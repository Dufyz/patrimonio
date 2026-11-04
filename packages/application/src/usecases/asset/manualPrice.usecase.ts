import { applyLedger, totalAmount } from '@patrimonio/calc';
import type { DateOnly, ManualPrice } from '@patrimonio/domain';
import { either, failure, success } from '@patrimonio/shared';

import { BadRequestError, NotFoundError } from '../../errors/app-error.js';
import type { AppError } from '../../errors/app-error.js';
import type { ManualPriceRepository } from '../../interfaces/manual_price.repository.js';
import type {
  TransactionalRepositories,
  UnitOfWork,
} from '../../interfaces/unit-of-work.js';
import { recalcEventsFor } from '../market/collectMarketData.usecase.js';

export type SetManualPriceInput = {
  readonly asset_id: string;
  readonly price_date: DateOnly;
  readonly price: string;
};

/**
 * O efeito do preço manual: o que a posição passa a valer e de onde vinha o
 * número antes. Enquanto não há fonte automática (E4), "antes" é o último preço
 * manual — ou o custo, quando nunca houve nenhum —, e a resposta diz qual dos
 * dois, em vez de deixar a tela adivinhar.
 */
export type ManualPricePreview = {
  readonly quantity: string;
  readonly previous_price: string | null;
  readonly previous_source: 'manual' | 'cost';
  readonly price: string;
  readonly position_value: { readonly before: string; readonly after: string };
};

/**
 * O preço manual muda o valor da posição daquele dia em diante, e quem lê o
 * gráfico e a consolidação é `position_daily` — que só o recálculo reescreve.
 * Por isso gravar ou remover o preço pede o recálculo das carteiras que têm o
 * ativo, na mesma transação: ou o preço e o pedido existem, ou nenhum existe.
 */
const requestRecalculation = async (
  repositories: TransactionalRepositories,
  assetId: string,
  fromDate: DateOnly,
) => {
  const holdings = await repositories.ledger.portfoliosHoldingAsset(assetId);
  if (holdings.isFailure()) return holdings;

  return repositories.outbox.enqueue(recalcEventsFor(holdings.value, fromDate));
};

export type SetManualPriceResult = {
  readonly manual_price: ManualPrice;
  readonly preview: ManualPricePreview;
};

export type ManualPriceDeps = { readonly unitOfWork: UnitOfWork };
export type ManualPriceReadDeps = { readonly manualPrices: ManualPriceRepository };

export const listManualPrices = (deps: ManualPriceReadDeps) =>
  either(async function* (assetId: string) {
    return yield* await deps.manualPrices.listByAsset(assetId);
  });

/**
 * Definir o preço de um ativo à mão. É o caminho para quando a fonte falha ou o
 * papel não tem cotação — e o preço fica marcado como manual enquanto vale, para
 * ninguém confundir um número digitado com um fechamento.
 */
export const setManualPrice = (deps: ManualPriceDeps) =>
  either(async function* (input: SetManualPriceInput) {
    return yield* await deps.unitOfWork.run<AppError, SetManualPriceResult>(
      async (repositories) => {
        const asset = await repositories.assets.findById(input.asset_id);
        if (asset.isFailure()) return asset;
        if (asset.value === null) {
          return failure(new NotFoundError(`Ativo ${input.asset_id} não encontrado`));
        }

        // Preço só existe em dia útil. A chave estrangeira do calendário só
        // garante que a data está dentro do período carregado — sábado e
        // domingo estão lá, com `is_business_day` falso —, então é esta
        // conferência que recusa um preço de domingo.
        const businessDay = await repositories.businessDays.isBusinessDay(
          input.price_date,
        );
        if (businessDay.isFailure()) return businessDay;
        if (!businessDay.value) {
          return failure(
            new BadRequestError(
              `${input.price_date} não é dia de pregão: preço só existe em dia útil`,
            ),
          );
        }

        const entries = await repositories.ledger.entriesForAsset(input.asset_id);
        if (entries.isFailure()) return entries;

        const position = applyLedger(entries.value, { until: input.price_date }).position;

        const previous = await repositories.manualPrices.latestUntil(
          input.asset_id,
          input.price_date,
        );
        if (previous.isFailure()) return previous;

        const previousPrice = previous.value?.price ?? null;
        const base = previousPrice ?? position.avg_price;

        const saved = await repositories.manualPrices.upsert({
          asset_id: input.asset_id,
          price_date: input.price_date,
          price: input.price,
        });
        if (saved.isFailure()) return saved;

        const queued = await requestRecalculation(
          repositories,
          input.asset_id,
          input.price_date,
        );
        if (queued.isFailure()) return queued;

        return success({
          manual_price: saved.value,
          preview: {
            quantity: position.quantity,
            previous_price: previousPrice,
            // `as const` porque o ternário de dois literais alarga para `string`:
            // o tipo do `run` é uma união, e união não serve de contexto para a
            // inferência do `success`.
            previous_source:
              previousPrice === null ? ('cost' as const) : ('manual' as const),
            price: input.price,
            position_value: {
              before: totalAmount(position.quantity, base),
              after: totalAmount(position.quantity, input.price),
            },
          },
        });
      },
    );
  });

export const deleteManualPrice = (deps: ManualPriceDeps) =>
  either(async function* (assetId: string, date: DateOnly) {
    return yield* await deps.unitOfWork.run<AppError, { readonly removed: boolean }>(
      async (repositories) => {
        const removed = await repositories.manualPrices.remove(assetId, date);
        if (removed.isFailure()) return removed;

        if (!removed.value) {
          return failure(
            new NotFoundError(`Não há preço manual de ${assetId} em ${date}`),
          );
        }

        const queued = await requestRecalculation(repositories, assetId, date);
        if (queued.isFailure()) return queued;

        return success({ removed: true });
      },
    );
  });
