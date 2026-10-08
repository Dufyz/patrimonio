import { adjustForEvents } from '@patrimonio/calc';
import type { AdjustedSeries } from '@patrimonio/calc';
import type { DateOnly } from '@patrimonio/domain';
import { either, failure, success } from '@patrimonio/shared';

import { NotFoundError } from '../../errors/app-error.js';
import type { AppError } from '../../errors/app-error.js';
import type { UnitOfWork } from '../../interfaces/unit-of-work.js';

/**
 * As duas séries de preço de um ativo: a negociada e a ajustada por evento.
 *
 * `asset_price` guarda o preço **como foi negociado** na data, e é esse número
 * que todo cálculo de patrimônio usa. O gráfico do ativo é o único lugar que
 * precisa da outra, porque nele um desdobramento 1:2 aparece como uma queda de
 * 50% que não aconteceu.
 *
 * As duas saem da mesma leitura, e o ajuste é derivado: alternar entre elas na
 * tela não altera nenhum dado gravado, e corrigir a data de um evento corrige o
 * gráfico sem reescrever dez anos de preço.
 */
export type AssetPriceSeriesInput = {
  readonly asset_id: string;
  readonly from?: DateOnly | undefined;
  readonly to?: DateOnly | undefined;
};

export type AssetPriceSeriesResult = {
  readonly asset_id: string;
  readonly ticker: string;
  readonly points: AdjustedSeries['points'];
  /** Os fatores aplicados: é a tabela de eventos do ativo. */
  readonly events: AdjustedSeries['applied'];
  /** Verdadeiro quando algum evento afeta o intervalo pedido. */
  readonly adjusted: boolean;
};

export type AssetPriceSeriesDeps = { readonly unitOfWork: UnitOfWork };

const FIRST = '1900-01-01' as DateOnly;
const LAST = '9999-12-31' as DateOnly;

export const getAssetPriceSeries = (deps: AssetPriceSeriesDeps) =>
  either(async function* (input: AssetPriceSeriesInput) {
    return yield* await deps.unitOfWork.run<AppError, AssetPriceSeriesResult>(
      async (repositories) => {
        const asset = await repositories.assets.findById(input.asset_id);
        if (asset.isFailure()) return asset;
        if (asset.value === null) {
          return failure(new NotFoundError(`Ativo ${input.asset_id} não encontrado`));
        }

        const from = input.from ?? FIRST;
        const to = input.to ?? LAST;

        const prices = await repositories.prices.pricesBetween(
          [input.asset_id],
          from,
          to,
        );
        if (prices.isFailure()) return prices;

        // Os eventos **confirmados**: um evento ainda não confirmado não mudou a
        // quantidade em carteira, então ajustar o gráfico por ele mostraria uma
        // série que não corresponde a nenhuma posição.
        const events = await repositories.corporateEvents.list({
          asset_id: input.asset_id,
        });
        if (events.isFailure()) return events;

        const confirmed = events.value.filter((event) => event.confirmed_at !== null);

        const series = adjustForEvents(
          prices.value.map((price) => ({
            price_date: price.price_date,
            close: price.close,
          })),
          confirmed.map((event) => ({
            record_date: event.record_date,
            ratio_from: event.ratio_from,
            ratio_to: event.ratio_to,
          })),
        );

        return success({
          asset_id: input.asset_id,
          ticker: asset.value.ticker,
          points: series.points,
          events: series.applied,
          adjusted: series.points.some((point) => point.factor !== '1.00000000'),
        });
      },
    );
  });
