import { dailyFactorsFrom } from '@patrimonio/calc';
import type { IndexObservation } from '@patrimonio/calc';
import { dedupeKey } from '@patrimonio/domain';
import type {
  DateOnly,
  IndexCode,
  MarketSourceRunDraft,
  OutboxEventDraft,
  PriceSourceKind,
} from '@patrimonio/domain';
import { either, success } from '@patrimonio/shared';
import type { Either } from '@patrimonio/shared';

import type { AppError } from '../../errors/app-error.js';
import { isFormatChangedError } from '../../errors/app-error.js';
import type { Clock } from '../../interfaces/clock.js';
import type {
  IndexProvider,
  QuoteSource,
  SourcedClosing,
  TreasurySource,
} from '../../interfaces/market_data.js';
import type {
  IndexQuoteWrite,
  MarketIngestionRepository,
} from '../../interfaces/market_ingestion.repository.js';
import type {
  TransactionalRepositories,
  UnitOfWork,
} from '../../interfaces/unit-of-work.js';
import { applyPlan } from '../../plans/apply.js';
import { planMarketIngestion } from '../../plans/market.plan.js';

/**
 * A coleta do dia: preços, índices e Tesouro, numa execução só, seguida do
 * fechamento.
 *
 * ## Por que os três no mesmo estágio
 *
 * O fechamento do dia só pode rodar quando preços **e** índices daquele dia
 * estiverem completos: a marcação na curva de um CDB depende do fator do CDI do
 * dia, e fechar antes dele gravaria o título rendendo zero. Colocar os três no
 * mesmo estágio torna essa dependência estrutural em vez de uma questão de
 * horário no cron — e o `close` é encadeado pela transição do pipeline, que só
 * acontece quando este estágio termina bem.
 *
 * Três agendamentos com quinze minutos de diferença funcionariam na maioria dos
 * dias. "Na maioria dos dias" é o problema: o dia em que a coleta demora é o dia
 * em que o fechamento sai errado, e ninguém olha.
 *
 * ## O que é falha e o que não é
 *
 * Papel sem cotação **não** é falha: ele entra em `missing`, a posição dele vale
 * o custo e a linha fica marcada. Fonte fora do ar também não derruba a coleta
 * dos índices. O que falha o estágio é o que não pode ser ignorado: formato
 * mudado — que é definitivo e para o job — e erro de escrita no banco.
 */
export type CollectMarketDataInput = {
  readonly reference_date?: DateOnly | undefined;
  readonly origin_request_id?: string | undefined;
};

export type CollectMarketDataResult = {
  readonly reference_date: DateOnly;
  readonly skipped: boolean;
  readonly prices_written: number;
  readonly indices_written: number;
  readonly missing: readonly string[];
  readonly source: string;
  readonly source_kind: PriceSourceKind | 'none';
};

export type CollectMarketDataDeps = {
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly quotes: QuoteSource;
  readonly indices: IndexProvider;
  readonly treasury: TreasurySource;
  /** Dias de tolerância antes de um preço ser considerado atrasado. */
  readonly staleAfterDays: number;
  /** As séries a coletar todo dia. */
  readonly indexCodes?: readonly IndexCode[] | undefined;
};

/** O registro da execução, para a tela de dados de mercado e o orçamento. */
const runOf = (input: {
  readonly source: string;
  readonly kind: MarketSourceRunDraft['kind'];
  readonly date: DateOnly;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly ok: boolean;
  readonly sourceKind?: PriceSourceKind | null;
  readonly requests?: number;
  readonly items?: number;
  readonly missing?: number;
  readonly error?: AppError | null;
}): MarketSourceRunDraft => ({
  source: input.source,
  kind: input.kind,
  reference_date: input.date,
  started_at: input.startedAt,
  finished_at: input.finishedAt,
  ok: input.ok,
  source_kind: input.sourceKind ?? null,
  requests: input.requests ?? 0,
  items: input.items ?? 0,
  missing: input.missing ?? 0,
  error: input.error === null || input.error === undefined ? null : input.error.message,
  detail:
    input.error !== null && input.error !== undefined && isFormatChangedError(input.error)
      ? {
          field: input.error.field,
          received: input.error.received,
        }
      : null,
});

const DEFAULT_CODES: readonly IndexCode[] = ['CDI', 'SELIC', 'IPCA'];

export const collectMarketData = (deps: CollectMarketDataDeps) =>
  either(async function* (input: CollectMarketDataInput) {
    const date = input.reference_date ?? deps.clock.today();

    // Dia sem pregão não tem preço para coletar. Pedir cotação num feriado
    // devolveria o fechamento de ontem com a data de hoje, que é como um preço
    // velho entra no sistema parecendo novo.
    const calendar = yield* await deps.unitOfWork.run<
      AppError,
      { readonly business: boolean; readonly days: readonly DateOnly[] }
    >(async (repositories) => {
      const business = await repositories.businessDays.isBusinessDay(date);
      if (business.isFailure()) return business;

      const month = await repositories.businessDays.listBetween(
        `${date.slice(0, 7)}-01` as DateOnly,
        date,
      );
      if (month.isFailure()) return month;

      return success({
        business: business.value,
        days: month.value
          .filter((day) => day.is_business_day)
          .map((day) => day.calendar_date),
      });
    });

    if (!calendar.business) {
      const nothing: CollectMarketDataResult = {
        reference_date: date,
        skipped: true,
        prices_written: 0,
        indices_written: 0,
        missing: [],
        source: 'none',
        source_kind: 'none',
      };

      return nothing;
    }

    const assets = yield* await deps.unitOfWork.run(async (repositories) =>
      repositories.market.priceableAssets(date),
    );

    const startedAt = deps.clock.now().toISOString();

    // ── Índices ──────────────────────────────────────────────────────────────
    const indexCodes = deps.indexCodes ?? DEFAULT_CODES;
    const indexResult = await deps.indices.fetchSeries(
      indexCodes,
      // O mês inteiro: o IPCA é publicado uma vez por mês e precisa ser
      // redistribuído pelos dias úteis dele quando sai.
      `${date.slice(0, 7)}-01` as DateOnly,
      date,
    );

    // Formato mudado numa fonte de índice para o estágio: marcar o CDB rendendo
    // zero é pior do que não marcar.
    if (indexResult.isFailure() && isFormatChangedError(indexResult.value)) {
      yield* await deps.unitOfWork.run(async (repositories) =>
        repositories.market.recordRun(
          runOf({
            source: deps.indices.id,
            kind: 'indices',
            date,
            startedAt,
            finishedAt: deps.clock.now().toISOString(),
            ok: false,
            error: indexResult.value,
          }),
        ),
      );

      return yield* indexResult;
    }

    const observations: IndexQuoteWrite[] = [];

    if (indexResult.isSuccess()) {
      const byCode = new Map<IndexCode, IndexObservation[]>();

      for (const sample of indexResult.value) {
        const bucket = byCode.get(sample.index_code) ?? [];
        bucket.push({
          reference_date: sample.reference_date,
          unit: sample.unit,
          raw_value: sample.raw_value,
        });
        byCode.set(sample.index_code, bucket);
      }

      for (const [code, samples] of byCode) {
        for (const factor of dailyFactorsFrom(samples, calendar.days)) {
          observations.push({
            index_code: code,
            quote_date: factor.quote_date as DateOnly,
            daily_factor: factor.daily_factor,
            raw_value: factor.raw_value,
            source: deps.indices.id,
          });
        }
      }
    }

    // ── Tesouro ──────────────────────────────────────────────────────────────
    const treasuryResult = await deps.treasury.fetchQuotes(date);
    if (treasuryResult.isFailure() && isFormatChangedError(treasuryResult.value)) {
      return yield* treasuryResult;
    }

    const treasury = treasuryResult.isSuccess()
      ? treasuryResult.value
      : { quotes: [], source: 'none', source_kind: 'none' as const };

    // ── Cotações ─────────────────────────────────────────────────────────────
    const tickers = assets
      .filter((asset) => asset.b3_type !== 'treasury')
      .map((asset) => asset.ticker);

    const closingResult =
      tickers.length === 0
        ? success<SourcedClosing>({
            quotes: [],
            missing: [],
            source: 'none',
            source_kind: 'none',
            requests: 0,
          })
        : await deps.quotes.fetchClosing(tickers, date);

    if (closingResult.isFailure()) {
      yield* await deps.unitOfWork.run(async (repositories) =>
        repositories.market.recordRun(
          runOf({
            source: 'quotes',
            kind: 'quotes',
            date,
            startedAt,
            finishedAt: deps.clock.now().toISOString(),
            ok: false,
            error: closingResult.value,
          }),
        ),
      );

      return yield* closingResult;
    }

    const closing = closingResult.value;

    // Regra desligada não gera alerta. A reconciliação completa — que preserva
    // adiado e ignorado — roda no estágio de alertas; aqui o que importa é não
    // escrever o que o usuário desligou.
    const enabledRules = yield* await deps.unitOfWork.run(async (repositories) => {
      const rules = await repositories.alerts.listRules();
      if (rules.isFailure()) return rules;

      return success(
        new Set(rules.value.filter((rule) => rule.enabled).map((rule) => rule.kind)),
      );
    });

    const latestKnown = yield* await deps.unitOfWork.run(async (repositories) => {
      const known = await repositories.prices.latestPricesOn(
        assets.map((asset) => asset.asset_id),
        date,
      );
      if (known.isFailure()) return known;

      return success(
        new Map(known.value.map((price) => [price.asset_id, price.price_date])),
      );
    });

    const plan = planMarketIngestion({
      reference_date: date,
      assets,
      closing,
      index_quotes: observations,
      treasury: treasury.quotes,
      treasury_source: treasury.source,
      treasury_source_kind: treasury.source_kind,
      stale_after_days: deps.staleAfterDays,
      latest_known: latestKnown,
    });

    const finishedAt = deps.clock.now().toISOString();

    return yield* await deps.unitOfWork.run<AppError, CollectMarketDataResult>(
      async (repositories) => {
        const written = await writeIngestion(repositories, plan);
        if (written.isFailure()) return written;

        for (const draft of [
          runOf({
            source: closing.source,
            kind: 'quotes',
            date,
            startedAt,
            finishedAt,
            ok: true,
            sourceKind: closing.source_kind === 'none' ? null : closing.source_kind,
            requests: closing.requests,
            items: plan.prices.length,
            missing: plan.missing.length,
          }),
          runOf({
            source: deps.indices.id,
            kind: 'indices',
            date,
            startedAt,
            finishedAt,
            ok: indexResult.isSuccess(),
            items: observations.length,
            error: indexResult.isFailure() ? indexResult.value : null,
          }),
          runOf({
            source: treasury.source,
            kind: 'treasury',
            date,
            startedAt,
            finishedAt,
            ok: treasuryResult.isSuccess(),
            sourceKind: treasury.source_kind === 'none' ? null : treasury.source_kind,
            items: treasury.quotes.length,
            error: treasuryResult.isFailure() ? treasuryResult.value : null,
          }),
        ]) {
          const recorded = await repositories.market.recordRun(draft);
          if (recorded.isFailure()) return recorded;
        }

        // O `close` do dia é encadeado pela transição do pipeline: ele só é
        // despachado porque este estágio terminou bem, e é assim que a ordem
        // "preços e índices antes do fechamento" deixa de depender do horário.
        const applied = await applyPlan(repositories, {
          stage: 'market',
          outcome: 'succeeded',
          portfolio_id: null,
          reference_date: date,
          alerts: {
            upserts: findingsAsAlerts(
              plan.findings.filter((finding) => enabledRules.has(finding.rule_kind)),
            ),
            resolved: [],
          },
          ...(input.origin_request_id === undefined
            ? {}
            : { origin_request_id: input.origin_request_id }),
        });
        if (applied.isFailure()) return applied;

        return success({
          reference_date: date,
          skipped: false,
          prices_written: plan.prices.length,
          indices_written: observations.length,
          missing: plan.missing.map((asset) => asset.ticker),
          source: closing.source,
          source_kind: closing.source_kind,
        });
      },
    );
  });

/**
 * A escrita das duas tabelas de ingestão, em lote. Separada do caso de uso para
 * o backfill reusar exatamente o mesmo caminho: dois caminhos de escrita
 * divergem com o tempo, e aí o preço do backfill passa a nascer diferente do
 * preço do dia.
 */
const writeIngestion = async (
  repositories: TransactionalRepositories,
  plan: {
    readonly prices: readonly { readonly asset_id: string }[];
    readonly index_quotes: readonly IndexQuoteWrite[];
  },
): Promise<Either<AppError, number>> => {
  const prices = await repositories.market.upsertPrices(
    plan.prices as Parameters<MarketIngestionRepository['upsertPrices']>[0],
  );
  if (prices.isFailure()) return prices;

  const indices = await repositories.market.upsertIndexQuotes(plan.index_quotes);
  if (indices.isFailure()) return indices;

  return success(prices.value + indices.value);
};

/**
 * O achado da regra vira a linha do alerta com `status: 'open'`. A reconciliação
 * completa — que preserva adiado e ignorado — roda no estágio de alertas; aqui a
 * escrita é de inserção, e o `UPSERT` por `(rule_kind, subject_id)` não
 * sobrescreve a decisão do usuário porque não toca em quem já existe com outro
 * status.
 */
const findingsAsAlerts = (
  findings: readonly {
    readonly rule_kind: string;
    readonly subject_id: string;
    readonly portfolio_id: string | null;
    readonly payload: Record<string, unknown>;
  }[],
) =>
  findings.map((finding) => ({
    rule_kind: finding.rule_kind,
    subject_id: finding.subject_id,
    portfolio_id: finding.portfolio_id,
    payload: finding.payload,
    status: 'open' as const,
    snooze_until: null,
  }));

export { runOf, findingsAsAlerts };

/** Os eventos que a coleta pede quando um preço antigo chega. */
export const recalcEventsFor = (
  holdings: readonly { readonly portfolio_id: string; readonly from_date: DateOnly }[],
  affectedFrom: DateOnly,
  originRequestId?: string,
): readonly OutboxEventDraft[] =>
  holdings.map((holding) => ({
    stage: 'recalc' as const,
    dedupe_key: dedupeKey.recalc(holding.portfolio_id),
    payload: {
      portfolio_id: holding.portfolio_id,
      // O recálculo parte da data afetada, mas nunca antes do primeiro
      // lançamento da carteira: reconstruir o que não existe é trabalho sem
      // efeito.
      from_date: affectedFrom < holding.from_date ? holding.from_date : affectedFrom,
    },
    ...(originRequestId === undefined ? {} : { origin_request_id: originRequestId }),
  }));
