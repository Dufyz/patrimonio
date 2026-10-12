import type {
  LiveQuote,
  LiveQuoteReading,
  LiveQuoteSource,
  QuoteSource,
} from '@patrimonio/application';
import type { DateOnly } from '@patrimonio/domain';

/**
 * A cotação de pregão da tela de Posições.
 *
 * Três decisões, todas para não gastar a cota da brapi nem travar a tela:
 *
 * - **Cache por papel.** Abrir três vezes a mesma carteira em um minuto é uma
 *   rodada de requisições, não três. Em pregão o cache vale um minuto; fora dele
 *   o último negócio não muda e vale vinte.
 * - **Uma requisição por vez.** O plano gratuito permite uma simultânea; a fila
 *   é única para a api inteira.
 * - **Prazo na resposta.** A tela espera `waitMs` pelas cotações e segue com o
 *   que chegou; o resto termina em segundo plano e entra na próxima leitura.
 *
 * Nada aqui grava no banco: o preço de pregão não é fechamento.
 */
export type LiveQuoteOptions = {
  readonly quotes: QuoteSource;
  readonly today: () => DateOnly;
  readonly now?: (() => number) | undefined;
  readonly waitMs?: number | undefined;
  readonly openTtlMs?: number | undefined;
  readonly closedTtlMs?: number | undefined;
};

type Entry = { readonly quote: LiveQuote | null; readonly at: number };

const SAO_PAULO = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'America/Sao_Paulo',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** Segunda a sexta, das 10:00 às 18:30 em Brasília. */
export const isTradingHours = (instant: number): boolean => {
  const parts = Object.fromEntries(
    SAO_PAULO.formatToParts(new Date(instant)).map((part) => [part.type, part.value]),
  );
  if (parts['weekday'] === 'Sat' || parts['weekday'] === 'Sun') return false;

  const minutes = Number(parts['hour']) * 60 + Number(parts['minute']);
  return minutes >= 10 * 60 && minutes <= 18 * 60 + 30;
};

export const createLiveQuoteSource = (options: LiveQuoteOptions): LiveQuoteSource => {
  const now = options.now ?? Date.now;
  const waitMs = options.waitMs ?? 3_500;
  const cache = new Map<string, Entry>();
  const inflight = new Map<string, Promise<void>>();
  let tail: Promise<void> = Promise.resolve();

  const ttl = (): number =>
    isTradingHours(now())
      ? (options.openTtlMs ?? 60_000)
      : (options.closedTtlMs ?? 20 * 60_000);

  const fetchOne = async (ticker: string): Promise<void> => {
    const result = await options.quotes.fetchClosing([ticker], options.today());
    const found =
      result.isSuccess() && result.value.source_kind !== 'none'
        ? result.value.quotes.find((quote) => quote.ticker.toUpperCase() === ticker)
        : undefined;

    // Falha também é lembrada: sem isso, fonte fora do ar vira uma requisição por
    // abertura de tela, por papel.
    cache.set(ticker, {
      at: now(),
      quote:
        found === undefined
          ? (cache.get(ticker)?.quote ?? null)
          : { ticker, price: found.close, price_date: found.price_date },
    });
  };

  const refresh = (ticker: string): Promise<void> => {
    const running = inflight.get(ticker);
    if (running !== undefined) return running;

    const job = tail
      .then(() => fetchOne(ticker))
      .catch(() => {
        cache.set(ticker, { at: now(), quote: cache.get(ticker)?.quote ?? null });
      })
      .finally(() => inflight.delete(ticker));

    tail = job;
    inflight.set(ticker, job);
    return job;
  };

  return {
    read: async (tickers): Promise<LiveQuoteReading> => {
      const wanted = [...new Set(tickers.map((ticker) => ticker.toUpperCase()))];
      const limit = ttl();

      const pending = wanted
        .filter((ticker) => {
          const entry = cache.get(ticker);
          return entry === undefined || now() - entry.at > limit;
        })
        .map(refresh);

      if (pending.length > 0) {
        await Promise.race([
          Promise.all(pending),
          new Promise<void>((resolve) => setTimeout(resolve, waitMs)),
        ]);
      }

      const quotes = new Map<string, LiveQuote>();
      let oldest: number | null = null;

      for (const ticker of wanted) {
        const entry = cache.get(ticker);
        if (entry?.quote == null) continue;

        quotes.set(ticker, entry.quote);
        oldest = oldest === null ? entry.at : Math.min(oldest, entry.at);
      }

      return { quotes, as_of: oldest === null ? null : new Date(oldest).toISOString() };
    },
  };
};
