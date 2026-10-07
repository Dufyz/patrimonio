import type { DateOnly, PriceSourceKind, PriceableAsset } from '@patrimonio/domain';
import { addDays } from '@patrimonio/domain';

import type { AlertFinding } from '../interfaces/alert.repository.js';
import type {
  AssetPriceWrite,
  IndexQuoteWrite,
} from '../interfaces/market_ingestion.repository.js';
import type {
  PriceQuote,
  SourcedClosing,
  TreasuryQuote,
} from '../interfaces/market_data.js';

/**
 * O plano da coleta: ele decide o que vai para `asset_price` e `index_quote`, o
 * que ficou sem preço e quais alertas isso abre. Função pura — o contexto entra
 * carregado, e nenhuma linha aqui faz I/O nem chama `new Date()`.
 *
 * A regra que governa este arquivo, e que vale mais do que todas as outras do
 * épico: **ausência nunca vira zero.** Um preço zero gravado por engano zera a
 * posição, e o erro se propaga por toda a série de `position_daily` até alguém
 * notar meses depois. Papel sem cotação entra em `missing`, a posição dele vale
 * o custo e a linha fica marcada.
 */
export const PRICE_STALE_RULE = 'price_stale';
export const PRICE_MISSING_RULE = 'price_missing';
export const CORPORATE_EVENT_RULE = 'corporate_event_pending';

export type MarketIngestionContext = {
  readonly reference_date: DateOnly;
  /** Os papéis que precisam de preço, vindos do livro. */
  readonly assets: readonly PriceableAsset[];
  readonly closing: SourcedClosing;
  readonly index_quotes: readonly IndexQuoteWrite[];
  /** As cotações do Tesouro, a casar por indexador e vencimento. */
  readonly treasury: readonly TreasuryQuote[];
  readonly treasury_source: string;
  readonly treasury_source_kind: PriceSourceKind | 'none';
  /**
   * Quantos dias úteis um preço pode ter antes de ser considerado atrasado. Vem
   * de `PRICE_STALE_AFTER_DAYS`.
   */
  readonly stale_after_days: number;
  /** O preço mais recente que cada papel já tinha, para medir o atraso. */
  readonly latest_known: ReadonlyMap<string, DateOnly>;
};

export type MarketIngestionPlan = {
  readonly prices: readonly AssetPriceWrite[];
  readonly index_quotes: readonly IndexQuoteWrite[];
  /** Papéis com posição aberta que ficaram sem preço do dia. */
  readonly missing: readonly PriceableAsset[];
  readonly findings: readonly AlertFinding[];
  readonly report: {
    readonly reference_date: DateOnly;
    readonly source: string;
    readonly source_kind: PriceSourceKind | 'none';
    readonly priced: number;
    readonly missing: number;
    readonly indices: number;
    readonly treasury: number;
    readonly requests: number;
  };
};

/**
 * A chave do título público: indexador e vencimento. O nome comercial não entra
 * — "Tesouro IPCA+ 2029" já mudou de forma duas vezes, e o par não muda.
 */
const treasuryKey = (kind: string, maturity: DateOnly): string =>
  `${kind}\u0000${maturity}`;

const isTreasury = (asset: PriceableAsset): boolean =>
  asset.b3_type === 'treasury' &&
  asset.indexer !== null &&
  asset.maturity_date !== null;

export const planMarketIngestion = (
  context: MarketIngestionContext,
): MarketIngestionPlan => {
  const byTicker = new Map<string, PriceQuote>(
    context.closing.quotes.map((quote) => [quote.ticker.toUpperCase(), quote]),
  );

  const byTreasury = new Map<string, TreasuryQuote>(
    context.treasury.map((quote) => [
      treasuryKey(quote.kind, quote.maturity_date),
      quote,
    ]),
  );

  const prices: AssetPriceWrite[] = [];
  const missing: PriceableAsset[] = [];

  for (const asset of context.assets) {
    if (isTreasury(asset)) {
      const quote = byTreasury.get(
        treasuryKey(asset.indexer ?? '', asset.maturity_date ?? context.reference_date),
      );

      if (quote === undefined || context.treasury_source_kind === 'none') {
        missing.push(asset);
        continue;
      }

      // O preço de **venda**: é quanto a posição vale se for vendida hoje, que é
      // a pergunta que a tela de patrimônio faz. O de compra responde "quanto
      // custaria comprar mais", e fica guardado para quem perguntar isso.
      prices.push({
        asset_id: asset.asset_id,
        price_date: quote.quote_date,
        close: quote.sell_price,
        source: context.treasury_source,
        source_kind: context.treasury_source_kind,
      });
      continue;
    }

    const quote = byTicker.get(asset.ticker.toUpperCase());

    if (quote === undefined || context.closing.source_kind === 'none') {
      missing.push(asset);
      continue;
    }

    prices.push({
      asset_id: asset.asset_id,
      price_date: quote.price_date,
      close: quote.close,
      source: context.closing.source,
      source_kind: context.closing.source_kind,
    });
  }

  return {
    prices,
    index_quotes: context.index_quotes,
    missing,
    findings: findingsFor(context, missing),
    report: {
      reference_date: context.reference_date,
      source: context.closing.source,
      source_kind: context.closing.source_kind,
      priced: prices.length,
      missing: missing.length,
      indices: context.index_quotes.length,
      treasury: context.treasury.length,
      requests: context.closing.requests,
    },
  };
};

/**
 * Os alertas que a coleta abre. Dois, e eles dizem coisas diferentes:
 *
 * - `price_missing` — nunca houve preço para o papel. A posição entra pelo custo
 *   e o usuário precisa decidir: preço manual, ou aceitar.
 * - `price_stale` — houve, e está velho. O número na tela ainda é um número, só
 *   não é o de hoje, e a tolerância vem de configuração.
 *
 * Separá-los importa porque a ação é diferente. Um alerta só de "preço com
 * problema" mandaria o usuário investigar os dois do mesmo jeito.
 */
const findingsFor = (
  context: MarketIngestionContext,
  missing: readonly PriceableAsset[],
): readonly AlertFinding[] => {
  const findings: AlertFinding[] = [];

  const limit = addDays(context.reference_date, -Math.abs(context.stale_after_days));

  for (const asset of missing) {
    const known = context.latest_known.get(asset.asset_id);

    if (known === undefined) {
      findings.push({
        rule_kind: PRICE_MISSING_RULE,
        subject_id: asset.asset_id,
        portfolio_id: null,
        payload: {
          ticker: asset.ticker,
          reference_date: context.reference_date,
          basis: 'cost',
        },
      });
      continue;
    }

    // Dentro da tolerância não é alerta: a B3 não negocia todo papel todo dia, e
    // avisar por isso treinaria o usuário a ignorar o painel.
    if (known >= limit) continue;

    findings.push({
      rule_kind: PRICE_STALE_RULE,
      subject_id: asset.asset_id,
      portfolio_id: null,
      payload: {
        ticker: asset.ticker,
        last_price_date: known,
        reference_date: context.reference_date,
      },
    });
  }

  return findings;
};

/**
 * O intervalo que o backfill de um papel precisa buscar: da primeira compra até
 * a data de referência, descontando o que já tem preço.
 *
 * Buscar só o que falta não é otimização — é o que impede que cada lançamento
 * retroativo refaça dez anos de carga. E o intervalo é contínuo de propósito: a
 * fonte cobra por requisição, não por dia, e pedir três trechos custa três
 * vezes mais do que pedir um.
 */
export type BackfillWindow = {
  readonly from: DateOnly;
  readonly to: DateOnly;
  readonly needed: boolean;
};

export const planBackfillWindow = (input: {
  readonly first_trade_date: DateOnly;
  readonly reference_date: DateOnly;
  /** Os dias úteis do intervalo: preço só existe em dia de pregão. */
  readonly business_days: readonly DateOnly[];
  readonly already_priced: readonly DateOnly[];
  /** Renda fixa de banco não tem preço de mercado: não há o que buscar. */
  readonly has_market_price: boolean;
}): BackfillWindow => {
  const whole = {
    from: input.first_trade_date,
    to: input.reference_date,
  } as const;

  // Renda fixa de banco é marcada na curva pela taxa cadastrada: nenhuma fonte
  // tem preço dela, e disparar backfill aqui gastaria requisição para receber
  // "não conheço esse papel".
  if (!input.has_market_price) return { ...whole, needed: false };
  if (input.first_trade_date > input.reference_date) return { ...whole, needed: false };

  const priced = new Set(input.already_priced);

  const pending = input.business_days.filter(
    (day) =>
      day >= input.first_trade_date &&
      day <= input.reference_date &&
      !priced.has(day),
  );

  const first = pending[0];
  const last = pending[pending.length - 1];

  if (first === undefined || last === undefined) return { ...whole, needed: false };

  // Um intervalo contínuo, e não um pedido por trecho: a fonte cobra por
  // requisição e não por dia, então três trechos custam três vezes mais.
  return { from: first, to: last, needed: true };
};
