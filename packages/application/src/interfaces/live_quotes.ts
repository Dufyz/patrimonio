import type { DateOnly } from '@patrimonio/domain';

/**
 * A cotação de pregão: o último negócio, e não o fechamento. Ela só alimenta a
 * leitura — a tela de Posições reavalia a posição com ela —, e **nunca** é
 * gravada em `asset_price`. Gravar preço intradiário como fechamento corromperia
 * a série; o fechamento continua sendo coisa do estágio das 18:30.
 */
export type LiveQuote = {
  readonly ticker: string;
  readonly price: string;
  /** A data do negócio que a fonte informou. */
  readonly price_date: DateOnly;
};

export type LiveQuoteReading = {
  readonly quotes: ReadonlyMap<string, LiveQuote>;
  /** Quando a leitura mais antiga usada foi feita; `null` sem nenhuma cotação. */
  readonly as_of: string | null;
};

/**
 * Nunca falha: fonte fora do ar devolve o que há em cache, e sem nada devolve
 * vazio. A tela sem cotação ao vivo é a tela de sempre, a preço de fechamento.
 */
export type LiveQuoteSource = {
  readonly read: (tickers: readonly string[]) => Promise<LiveQuoteReading>;
};
