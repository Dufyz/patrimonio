import type { TransactionKind } from '@patrimonio/domain';
import { either, failure } from '@patrimonio/shared';

import { NotFoundError } from '../../errors/app-error.js';
import type {
  AssetPagePeriod,
  AssetPageRepository,
} from '../../interfaces/asset_page.repository.js';
import type { Clock } from '../../interfaces/clock.js';

/**
 * T-03 · Tudo sobre um ativo em um lugar.
 *
 * O caso de uso não calcula: ele organiza e decide uma coisa só — que ativo
 * inexistente é 404, e não uma página com seis traços. A diferença importa
 * porque um endereço velho colado de um favorito precisa dizer "esse papel não
 * existe mais" em vez de parecer um papel sem histórico.
 *
 * As somas vêm do Postgres em `numeric`. Refazê-las aqui introduziria uma
 * segunda verdade — a que a tela mostra — ao lado da que o banco guarda, e as
 * duas divergiriam no primeiro centavo.
 */
export type GetAssetPageInput = {
  readonly assetId: string;
  readonly portfolioId: string;
  readonly period: AssetPagePeriod;
  readonly kind: TransactionKind | null;
};

export type GetAssetPageDeps = {
  readonly assetPages: AssetPageRepository;
  /** O dia de hoje entra pelo relógio injetado, nunca por `new Date()`. */
  readonly clock: Clock;
};

export const getAssetPage = (deps: GetAssetPageDeps) =>
  either(async function* (input: GetAssetPageInput) {
    const view = yield* await deps.assetPages.open({
      today: deps.clock.today(),
      assetId: input.assetId,
      portfolioId: input.portfolioId,
      period: input.period,
      kind: input.kind,
    });

    if (view.asset === null) {
      return yield* failure(new NotFoundError(`Ativo ${input.assetId} não encontrado`));
    }

    return {
      portfolio_id: input.portfolioId,
      portfolio_name: view.portfolio_name,
      as_of: view.as_of,
      computed_at: view.computed_at,

      asset: view.asset,
      price: view.price,
      position: view.position,

      series: {
        period: input.period,
        from: view.window.from,
        to: view.window.to,
        points: view.points.map((point) => ({ ...point })),
        marks: view.marks.map((mark) => ({ ...mark })),
        adjusted: view.window.adjusted,
        return_ratio: view.window.return_ratio,
        return_with_payouts_ratio: view.window.return_with_payouts_ratio,
      },

      payouts: {
        months: view.payout_months.map((month) => ({ ...month })),
        total_12m: view.payouts_total_12m,
        upcoming: view.upcoming_payouts.map((payout) => ({ ...payout })),
      },

      transactions: {
        recent: view.transactions.map((transaction) => ({ ...transaction })),
        total: view.transactions_total,
        facets: view.transaction_facets.map((facet) => ({ ...facet })),
      },

      corporate_events: view.corporate_events.map((event) => ({ ...event })),
      portfolios: view.portfolios.map((portfolio) => ({ ...portfolio })),
      custodians: view.custodians.map((custodian) => ({ ...custodian })),
    };
  });
