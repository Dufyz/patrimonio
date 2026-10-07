import { isFormatChangedError } from '@patrimonio/application';
import type {
  AppError,
  QuoteProvider,
  QuoteSource,
  SourcedClosing,
  TreasuryProvider,
  TreasurySource,
} from '@patrimonio/application';
import type { DateOnly, PriceSourceKind } from '@patrimonio/domain';
import { success } from '@patrimonio/shared';
import type { Either } from '@patrimonio/shared';

/**
 * A cadeia de fallback. A ordem vem de configuração, não de código: o primeiro
 * elo é o provedor principal, e `source_kind` sai da posição na lista.
 *
 * Três regras, e cada uma existe por um motivo diferente:
 *
 * 1. **Só falha de infraestrutura passa adiante.** Ticker inexistente não é
 *    falha: ele volta em `missing`, e trocar de provedor por causa dele
 *    gastaria a cota da alternativa para receber o mesmo `missing`.
 * 2. **`FormatChangedError` interrompe a cadeia.** Se a resposta da fonte
 *    principal mudou de forma, o problema é nosso parser — tentar a alternativa
 *    esconderia isso por semanas, e o job precisa parar para alguém olhar.
 * 3. **Toda a cadeia fora do ar devolve sucesso com `source_kind: 'none'`.**
 *    Nada é gravado, o dia fica marcado, e a posição continua valendo o último
 *    preço conhecido em vez de zero. Falhar aqui faria o estágio reexecutar e
 *    não traria preço nenhum.
 */
const kindFor = (index: number): PriceSourceKind =>
  index === 0 ? 'primary' : 'fallback';

const nothing = (
  tickers: readonly string[],
  requests: number,
): SourcedClosing => ({
  quotes: [],
  missing: [...tickers],
  source: 'none',
  source_kind: 'none',
  requests,
});

export const createQuoteChain = (
  providers: readonly QuoteProvider[],
): QuoteSource => ({
  fetchClosing: async (
    tickers: readonly string[],
    date: DateOnly,
  ): Promise<Either<AppError, SourcedClosing>> => {
    let requests = 0;

    for (const [index, provider] of providers.entries()) {
      requests += provider.requestsIn(tickers);

      const result = await provider.fetchClosing(tickers, date);

      if (result.isSuccess()) {
        return success({
          ...result.value,
          source: provider.id,
          source_kind: kindFor(index),
          requests,
        });
      }

      // Formato mudou: o próximo elo não resolve, e seguir esconderia o
      // problema atrás de um preço que vem de outra fonte.
      if (isFormatChangedError(result.value)) return result;
    }

    return success(nothing(tickers, requests));
  },

  fetchHistory: async (
    ticker: string,
    from: DateOnly,
    to: DateOnly,
  ): Promise<Either<AppError, SourcedClosing>> => {
    let requests = 0;

    for (const [index, provider] of providers.entries()) {
      if (provider.fetchHistory === undefined) continue;

      requests += provider.requestsIn([ticker]);

      const result = await provider.fetchHistory(ticker, from, to);

      if (result.isSuccess()) {
        return success({
          ...result.value,
          source: provider.id,
          source_kind: kindFor(index),
          requests,
        });
      }

      if (isFormatChangedError(result.value)) return result;
    }

    return success(nothing([ticker], requests));
  },
});

/**
 * A mesma mecânica para o Tesouro: o JSON do site é o principal e o CSV do
 * Tesouro Transparente é a alternativa, que também é de onde vem o histórico
 * completo desde 2002.
 */
export const createTreasuryChain = (
  providers: readonly TreasuryProvider[],
): TreasurySource => ({
  fetchQuotes: async (date: DateOnly) => {
    for (const [index, provider] of providers.entries()) {
      const result = await provider.fetchQuotes(date);

      if (result.isSuccess()) {
        return success({
          quotes: result.value,
          source: provider.id,
          source_kind: kindFor(index),
        });
      }

      if (isFormatChangedError(result.value)) return result;
    }

    return success({
      quotes: [] as const,
      source: 'none',
      source_kind: 'none' as const,
    });
  },
});
