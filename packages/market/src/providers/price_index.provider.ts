import { isFormatChangedError } from '@patrimonio/application';
import type {
  AppError,
  IndexProvider,
  IndexSample,
  QuoteSource,
} from '@patrimonio/application';
import { addDays } from '@patrimonio/domain';
import type { DateOnly, IndexCode } from '@patrimonio/domain';
import { failure, success } from '@patrimonio/shared';
import type { Either } from '@patrimonio/shared';

/**
 * Índices de pontos — IBOV e IFIX — lidos pela mesma cadeia das cotações, com o
 * mesmo fallback entre provedores. O símbolo de cada índice vem da configuração
 * dos provedores: é o único lugar em que o nome da fonte para o índice aparece.
 *
 * Cada fechamento sai como amostra `index_points`, e o fator do dia é a razão
 * entre dois fechamentos consecutivos, calculada em `calc`. Por isso o pedido
 * começa alguns dias antes: o primeiro dia do período precisa do fechamento
 * anterior para ter fator.
 */
export const PRICE_INDEX_LOOKBACK_DAYS = 7;

export type PriceIndexSymbols = Readonly<Partial<Record<IndexCode, string>>>;

export const createPriceIndexProvider = (options: {
  readonly id: string;
  readonly quotes: QuoteSource;
  readonly symbols: PriceIndexSymbols;
}): IndexProvider => {
  const served = (Object.keys(options.symbols) as IndexCode[]).filter(
    (code) => options.symbols[code] !== undefined,
  );

  return {
    id: options.id,
    series: served,

    fetchSeries: async (
      codes: readonly IndexCode[],
      from: DateOnly,
      to: DateOnly,
    ): Promise<Either<AppError, readonly IndexSample[]>> => {
      const samples: IndexSample[] = [];
      const start = addDays(from, -PRICE_INDEX_LOOKBACK_DAYS);

      for (const code of codes) {
        const symbol = options.symbols[code];
        if (symbol === undefined) continue;

        const history = await options.quotes.fetchHistory(symbol, start, to);
        if (history.isFailure()) return history;

        for (const quote of history.value.quotes) {
          samples.push({
            index_code: code,
            reference_date: quote.price_date,
            unit: 'index_points',
            raw_value: quote.close,
            source: history.value.source,
          });
        }
      }

      return success(samples);
    },
  };
};

/**
 * Junta provedores de índice em um só: cada código é pedido a quem o serve, e
 * as amostras voltam todas juntas.
 *
 * Um provedor fora do ar não derruba os outros — o CDI do Banco Central não pode
 * deixar de ser coletado porque a cotação do Ibovespa não respondeu. Formato
 * mudado, ao contrário, encerra: é problema do parser, e esconder esse sinal
 * atrás de uma série que veio de outro lugar adia o conserto.
 */
export const createIndexProviderSet = (
  id: string,
  providers: readonly IndexProvider[],
): IndexProvider => ({
  id,
  series: [...new Set(providers.flatMap((provider) => provider.series))],

  fetchSeries: async (codes, from, to) => {
    const samples: IndexSample[] = [];
    let unavailable: AppError | null = null;

    for (const provider of providers) {
      const mine = codes.filter((code) => provider.series.includes(code));
      if (mine.length === 0) continue;

      const result = await provider.fetchSeries(mine, from, to);

      if (result.isFailure()) {
        if (isFormatChangedError(result.value)) return result;

        unavailable = result.value;
        continue;
      }

      samples.push(
        ...result.value.map((sample) =>
          sample.source === undefined ? { ...sample, source: provider.id } : sample,
        ),
      );
    }

    if (samples.length === 0 && unavailable !== null) return failure(unavailable);

    return success(samples);
  },
});
