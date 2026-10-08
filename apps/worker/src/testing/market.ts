import type {
  IndexProvider,
  IndexSample,
  PriceQuote,
  QuoteSource,
  TreasuryQuote,
  TreasurySource,
} from '@patrimonio/application';
import type { DateOnly, IndexCode } from '@patrimonio/domain';
import { success } from '@patrimonio/shared';

/**
 * As fontes roteirizadas dos testes de estágio. Não são dublês de repositório —
 * o banco e o Redis são reais — e sim o provedor de mercado, que é a única coisa
 * que a estratégia de testes manda simular: resposta gravada em arquivo nos
 * testes de provedor, e roteiro aqui, onde o que se mede é o pipeline.
 */
export type Script = {
  readonly quotes?: readonly PriceQuote[] | undefined;
  readonly missing?: readonly string[] | undefined;
  readonly source?: string | undefined;
  readonly sourceKind?: 'primary' | 'fallback' | 'none' | undefined;
  readonly indices?: readonly IndexSample[] | undefined;
  readonly treasury?: readonly TreasuryQuote[] | undefined;
  readonly history?: readonly PriceQuote[] | undefined;
};

export const scriptedQuotes = (script: Script): QuoteSource => ({
  fetchClosing: async (tickers) =>
    success({
      quotes: script.quotes ?? [],
      missing:
        script.missing ??
        tickers.filter(
          (ticker) =>
            !(script.quotes ?? []).some(
              (quote) => quote.ticker.toUpperCase() === ticker.toUpperCase(),
            ),
        ),
      source: script.source ?? 'brapi',
      source_kind: script.sourceKind ?? 'primary',
      requests: tickers.length,
    }),

  fetchHistory: async (ticker, from, to) => {
    const quotes = (script.history ?? []).filter(
      (quote) => quote.price_date >= from && quote.price_date <= to,
    );

    return success({
      quotes,
      missing: quotes.length === 0 ? [ticker] : [],
      source: script.source ?? 'cotahist',
      source_kind: script.sourceKind ?? 'primary',
      requests: 1,
    });
  },
});

export const scriptedIndices = (script: Script): IndexProvider => ({
  id: 'bcb',
  series: ['CDI', 'SELIC', 'IPCA'] as readonly IndexCode[],
  fetchSeries: async (codes) =>
    success((script.indices ?? []).filter((sample) => codes.includes(sample.index_code))),
});

export const scriptedTreasury = (script: Script): TreasurySource => ({
  fetchQuotes: async (date: DateOnly) =>
    success({
      quotes: (script.treasury ?? []).filter((quote) => quote.quote_date === date),
      source: 'tesouro-direto',
      source_kind: 'primary' as const,
    }),
});

/** Uma série de CDI constante, para o teste não precisar de fixture de índice. */
export const cdiSeries = (
  days: readonly DateOnly[],
  dailyPct = '0.041957',
): readonly IndexSample[] =>
  days.map((day) => ({
    index_code: 'CDI' as IndexCode,
    reference_date: day,
    unit: 'daily_pct' as const,
    raw_value: dailyPct,
  }));
