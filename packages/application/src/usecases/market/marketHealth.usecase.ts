import { dedupeKey } from '@patrimonio/domain';
import type { DateOnly, MarketRunKind, MarketSourceRun } from '@patrimonio/domain';
import { either, failure, success } from '@patrimonio/shared';

import { BadRequestError } from '../../errors/app-error.js';
import type { AppError } from '../../errors/app-error.js';
import type { Clock } from '../../interfaces/clock.js';
import type { EnqueuedEvent } from '../../interfaces/outbox.repository.js';
import type { UnitOfWork } from '../../interfaces/unit-of-work.js';

/**
 * A situação dos dados de mercado. Ela existe para responder uma pergunta só:
 * **o número que está na tela é de hoje?**
 *
 * Mostrar um patrimônio desatualizado com a mesma confiança de um atualizado é
 * o erro que destrói a confiança no app inteiro — e é um erro que não aparece,
 * porque o número continua parecendo um número. Então a resposta carrega, por
 * fonte, situação, horário da última coleta, cobertura e consumo de cota; e a
 * falha carrega a **mensagem** do erro, porque "brapi respondeu 503" diz o que
 * fazer e um código não diz nada.
 */
export type SourceBudget = {
  readonly used: number;
  readonly ceiling: number;
  readonly remaining: number;
  readonly warning: boolean;
  readonly exceeded: boolean;
};

export type SourceHealth = {
  readonly source: string;
  readonly kind: MarketRunKind;
  readonly status: 'ok' | 'stale' | 'failing' | 'never_run';
  readonly last_run: MarketSourceRun | null;
  readonly coverage: { readonly items: number; readonly missing: number };
  readonly budget: SourceBudget | null;
};

export type MissingPrice = {
  readonly asset_id: string;
  readonly ticker: string;
  readonly last_price_date: DateOnly | null;
};

export type MarketHealthResult = {
  readonly reference_date: DateOnly;
  readonly sources: readonly SourceHealth[];
  readonly recent_failures: readonly MarketSourceRun[];
  readonly missing_prices: readonly MissingPrice[];
};

export type MarketHealthInput = { readonly on_date?: DateOnly | undefined };

export type MarketHealthDeps = {
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  /** O teto de requisições por fonte, de onde a configuração disser. */
  readonly ceilings?: Readonly<Record<string, number>> | undefined;
  readonly staleAfterDays?: number | undefined;
};

const WARNING_RATIO = 0.8;
const RECENT_FAILURES = 10;

const budgetFor = (used: number, ceiling: number | undefined): SourceBudget | null => {
  if (ceiling === undefined || ceiling <= 0) return null;

  const ratio = used / ceiling;

  return {
    used,
    ceiling,
    remaining: Math.max(0, ceiling - used),
    warning: ratio >= WARNING_RATIO,
    exceeded: used >= ceiling,
  };
};

/**
 * A situação de uma fonte. `stale` não é falha: a coleta deu certo e o dado é de
 * antes — o que é normal num fim de semana e preocupante numa terça.
 */
const statusOf = (
  run: MarketSourceRun | null,
  date: DateOnly,
  staleAfterDays: number,
): SourceHealth['status'] => {
  if (run === null) return 'never_run';
  if (!run.ok) return 'failing';
  if (run.reference_date === null) return 'ok';

  const limit = new Date(`${date}T00:00:00.000Z`);
  limit.setUTCDate(limit.getUTCDate() - Math.abs(staleAfterDays));

  return run.reference_date < limit.toISOString().slice(0, 10) ? 'stale' : 'ok';
};

export const getMarketHealth = (deps: MarketHealthDeps) =>
  either(async function* (input: MarketHealthInput) {
    const date = input.on_date ?? deps.clock.today();

    // A janela do orçamento é o mês corrente: é como o teto do plano é contado.
    const since = `${date.slice(0, 7)}-01T00:00:00.000Z`;

    return yield* await deps.unitOfWork.run<AppError, MarketHealthResult>(
      async (repositories) => {
        const statuses = await repositories.market.sourceStatuses({
          requests_since: since,
        });
        if (statuses.isFailure()) return statuses;

        const failures = await repositories.market.recentFailures(RECENT_FAILURES);
        if (failures.isFailure()) return failures;

        const withoutPrice = await repositories.prices.assetsWithoutPriceOn(date);
        if (withoutPrice.isFailure()) return withoutPrice;

        // Os papéis sem preço do dia, com a última data em que houve algum. Uma
        // consulta para os dois, porque a tela mostra os dois juntos.
        const latest = await repositories.prices.latestPricesOn(withoutPrice.value, date);
        if (latest.isFailure()) return latest;

        const lastByAsset = new Map(
          latest.value.map((price) => [price.asset_id, price.price_date]),
        );

        const assets = await repositories.market.priceableAssets(date);
        if (assets.isFailure()) return assets;

        const tickerOf = new Map(
          assets.value.map((asset) => [asset.asset_id, asset.ticker]),
        );

        const staleAfterDays = deps.staleAfterDays ?? 3;

        return success({
          reference_date: date,
          sources: statuses.value.map((status): SourceHealth => ({
            source: status.source,
            kind: status.kind,
            status: statusOf(status.last_run, date, staleAfterDays),
            last_run: status.last_run,
            coverage: {
              items: status.last_run?.items ?? 0,
              missing: status.last_run?.missing ?? 0,
            },
            budget: budgetFor(status.requests_in_window, deps.ceilings?.[status.source]),
          })),
          recent_failures: failures.value,
          missing_prices: withoutPrice.value.map((assetId) => ({
            asset_id: assetId,
            ticker: tickerOf.get(assetId) ?? assetId,
            last_price_date: lastByAsset.get(assetId) ?? null,
          })),
        });
      },
    );
  });

/**
 * "Atualizar agora": enfileira e devolve na hora. A coleta leva segundos, e a
 * tela não pode ficar esperando a fonte responder — então a rota responde 202
 * com o par `job_id` e `already_queued`, e a coalescência cuida de dois cliques
 * seguidos virarem uma coleta.
 */
export type RefreshMarketInput = {
  readonly on_date?: DateOnly | undefined;
  readonly asset_id?: string | undefined;
  readonly origin_request_id?: string | undefined;
};

export type RefreshMarketResult = {
  readonly reference_date: DateOnly;
  readonly queued: EnqueuedEvent;
};

export const refreshMarketData = (deps: {
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
}) =>
  either(async function* (input: RefreshMarketInput) {
    const date = input.on_date ?? deps.clock.today();

    return yield* await deps.unitOfWork.run<AppError, RefreshMarketResult>(
      async (repositories) => {
        const enqueued = await repositories.outbox.enqueue([
          {
            stage: 'market',
            // Com ativo é backfill daquele papel; sem, é a coleta do dia.
            dedupe_key:
              input.asset_id === undefined
                ? dedupeKey.market(date)
                : dedupeKey.backfill(input.asset_id),
            payload:
              input.asset_id === undefined
                ? { reference_date: date }
                : { reference_date: date, asset_id: input.asset_id },
            ...(input.origin_request_id === undefined
              ? {}
              : { origin_request_id: input.origin_request_id }),
          },
        ]);
        if (enqueued.isFailure()) return enqueued;

        const queued = enqueued.value[0];
        if (queued === undefined) {
          return failure(
            new BadRequestError('O pedido de coleta não produziu evento nenhum'),
          );
        }

        return success({ reference_date: date, queued });
      },
    );
  });
