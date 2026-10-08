import type { DateOnly } from '@patrimonio/domain';
import { either, success } from '@patrimonio/shared';

import type { AppError } from '../../errors/app-error.js';
import type { Clock } from '../../interfaces/clock.js';
import type { CorporateActionProvider } from '../../interfaces/market_data.js';
import type { AnnouncedPayoutWrite } from '../../interfaces/market_ingestion.repository.js';
import type { UnitOfWork } from '../../interfaces/unit-of-work.js';

/**
 * Proventos e eventos corporativos anunciados pela fonte.
 *
 * Nenhuma fonte gratuita cobre isso de forma confiável hoje: a decisão
 * registrada em "Provedores externos" é lançamento manual, e o gatilho para
 * pagar o plano pago é "lançar provento à mão virar incômodo real". Então o
 * provedor é **opcional** — sem ele este caso de uso não roda, e nada no
 * pipeline muda.
 *
 * O que ele faz quando existe:
 *
 * - **Provento anunciado** vira linha em `announced_payout`. Não vira lançamento
 *   aqui: quem decide isso é `materializeAnnouncedPayouts`, que olha a posição na
 *   data-com.
 * - **Evento corporativo** vira linha em `corporate_event` **não confirmada**, e
 *   a quantidade em carteira não muda. Um desdobramento aplicado com data errada
 *   reescreve preço médio e resultado de todo o histórico, e o erro aparece como
 *   número, não como erro. A confirmação do usuário é um clique contra uma
 *   reescrita de dez anos.
 */
export type IngestCorporateActionsInput = {
  readonly from: DateOnly;
  readonly to?: DateOnly | undefined;
  readonly origin_request_id?: string | undefined;
};

export type IngestCorporateActionsResult = {
  readonly payouts_announced: number;
  readonly events_detected: number;
  /** Tickers anunciados que não estão no cadastro: nada é criado por anúncio. */
  readonly unknown_tickers: readonly string[];
};

export type IngestCorporateActionsDeps = {
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly provider: CorporateActionProvider;
};

export const ingestCorporateActions = (deps: IngestCorporateActionsDeps) =>
  either(async function* (input: IngestCorporateActionsInput) {
    const to = input.to ?? deps.clock.today();

    const assets = yield* await deps.unitOfWork.run(async (repositories) =>
      repositories.market.priceableAssets(to),
    );

    const byTicker = new Map(
      assets.map((asset) => [asset.ticker.toUpperCase(), asset.asset_id]),
    );

    if (byTicker.size === 0) {
      const nothing: IngestCorporateActionsResult = {
        payouts_announced: 0,
        events_detected: 0,
        unknown_tickers: [],
      };

      return nothing;
    }

    const announcements = yield* await deps.provider.fetchAnnouncements(
      [...byTicker.keys()],
      input.from,
      to,
    );

    const unknown = new Set<string>();

    const payouts: AnnouncedPayoutWrite[] = [];

    for (const payout of announcements.payouts) {
      const assetId = byTicker.get(payout.ticker.toUpperCase());

      // Anúncio de papel que não está no cadastro é descartado: a fonte anuncia
      // o mercado inteiro, e criar ativo por anúncio encheria o cadastro de
      // papel que ninguém tem.
      if (assetId === undefined) {
        unknown.add(payout.ticker.toUpperCase());
        continue;
      }

      payouts.push({
        asset_id: assetId,
        payout_kind: payout.payout_kind,
        record_date: payout.record_date,
        payment_date: payout.payment_date,
        amount_per_share: payout.amount_per_share,
        source: deps.provider.id,
      });
    }

    return yield* await deps.unitOfWork.run<AppError, IngestCorporateActionsResult>(
      async (repositories) => {
        const written = await repositories.market.upsertAnnouncedPayouts(payouts);
        if (written.isFailure()) return written;

        let events = 0;

        for (const event of announcements.events) {
          const assetId = byTicker.get(event.ticker.toUpperCase());
          if (assetId === undefined) {
            unknown.add(event.ticker.toUpperCase());
            continue;
          }

          // Nasce sem `confirmed_at`: é o alerta que leva o usuário a decidir, e
          // reanunciar o mesmo evento não reabre o que já foi confirmado.
          const upserted = await repositories.corporateEvents.upsert({
            asset_id: assetId,
            kind: event.kind,
            record_date: event.record_date,
            ratio_from: event.ratio_from,
            ratio_to: event.ratio_to,
          });
          if (upserted.isFailure()) return upserted;

          events += 1;
        }

        return success({
          payouts_announced: written.value,
          events_detected: events,
          unknown_tickers: [...unknown],
        });
      },
    );
  });
