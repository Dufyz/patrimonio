import type {
  DateOnly,
  IndexCode,
  MarketRunKind,
  MarketSourceRun,
  MarketSourceRunDraft,
  PriceSourceKind,
  PriceableAsset,
} from '@patrimonio/domain';
import type { Either } from '@patrimonio/shared';

import type { AppError } from '../errors/app-error.js';

/**
 * A escrita das tabelas de ingestão. Elas são o único lugar do sistema em que o
 * mundo externo entra: tudo mais é lançamento do usuário ou projeção calculada.
 *
 * A escrita é sempre em lote e sempre `UPSERT`. Em lote porque o fechamento de
 * uma carteira com trezentos papéis não pode virar trezentas idas ao banco — o
 * banco está em outra rede. `UPSERT` porque recoletar o mesmo dia é normal: o
 * job reexecuta, a fonte corrige um preço, e reimportar o mesmo ano do COTAHIST
 * não pode duplicar nada.
 */
export type AssetPriceWrite = {
  readonly asset_id: string;
  readonly price_date: DateOnly;
  readonly close: string;
  readonly source: string;
  readonly source_kind: PriceSourceKind;
};

export type IndexQuoteWrite = {
  readonly index_code: IndexCode;
  readonly quote_date: DateOnly;
  readonly daily_factor: string;
  readonly raw_value: string | null;
  readonly source: string;
};

export type AnnouncedPayoutWrite = {
  readonly asset_id: string;
  readonly payout_kind: 'dividend' | 'jcp' | 'income' | 'interest' | 'amortization';
  readonly record_date: DateOnly;
  readonly payment_date: DateOnly | null;
  readonly amount_per_share: string;
  readonly source: string;
};

/** Um provento anunciado que ainda não virou lançamento. */
export type PendingAnnouncedPayout = {
  readonly id: string;
  readonly asset_id: string;
  readonly payout_kind: AnnouncedPayoutWrite['payout_kind'];
  readonly record_date: DateOnly;
  readonly payment_date: DateOnly | null;
  readonly amount_per_share: string;
};

/** O que a tela de dados de mercado mostra de cada fonte. */
export type SourceStatus = {
  readonly source: string;
  readonly kind: MarketRunKind;
  readonly last_run: MarketSourceRun | null;
  /** Requisições consumidas na janela de orçamento. */
  readonly requests_in_window: number;
};

export type MarketIngestionRepository = {
  /**
   * Os preços do dia. Numa data com preço manual, o manual continua vencendo —
   * a precedência está na leitura, em `PriceRepository`, e não é esta escrita
   * que a decide.
   */
  readonly upsertPrices: (
    rows: readonly AssetPriceWrite[],
  ) => Promise<Either<AppError, number>>;

  readonly upsertIndexQuotes: (
    rows: readonly IndexQuoteWrite[],
  ) => Promise<Either<AppError, number>>;

  /**
   * Os papéis que precisam de preço numa data: quem tem posição aberta e
   * cotação automática. Sai do livro, não do cadastro — ativo arquivado sem
   * posição não é problema de ninguém, e pedir cotação dele gastaria cota.
   *
   * Renda fixa de banco fica fora: ela é marcada na curva e não tem preço de
   * mercado nenhum para buscar.
   */
  readonly priceableAssets: (
    date: DateOnly,
  ) => Promise<Either<AppError, PriceableAsset[]>>;

  /** Um papel específico, para o backfill saber de quando partir. */
  readonly priceableAsset: (
    assetId: string,
  ) => Promise<Either<AppError, PriceableAsset | null>>;

  /**
   * As datas em que um papel já tem preço, num intervalo. O backfill busca só o
   * que falta: repetir dez anos de COTAHIST a cada lançamento retroativo seria
   * trabalho sem efeito.
   */
  readonly pricedDates: (
    assetId: string,
    from: DateOnly,
    to: DateOnly,
  ) => Promise<Either<AppError, DateOnly[]>>;

  readonly recordRun: (
    draft: MarketSourceRunDraft,
  ) => Promise<Either<AppError, MarketSourceRun>>;

  /** A última execução de cada par (fonte, tipo): é a situação que a tela mostra. */
  readonly sourceStatuses: (
    options: { readonly requests_since: string },
  ) => Promise<Either<AppError, SourceStatus[]>>;

  readonly recentFailures: (
    limit: number,
  ) => Promise<Either<AppError, MarketSourceRun[]>>;

  readonly lastRunOf: (
    source: string,
    kind: MarketRunKind,
  ) => Promise<Either<AppError, MarketSourceRun | null>>;

  readonly upsertAnnouncedPayouts: (
    rows: readonly AnnouncedPayoutWrite[],
  ) => Promise<Either<AppError, number>>;

  /** Anunciados sem lançamento gerado, para a materialização decidir. */
  readonly pendingAnnouncedPayouts: () => Promise<
    Either<AppError, PendingAnnouncedPayout[]>
  >;

  readonly markPayoutMaterialized: (
    announcedId: string,
    transactionId: string,
  ) => Promise<Either<AppError, boolean>>;
};
