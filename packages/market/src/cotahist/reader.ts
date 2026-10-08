import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

import { FormatChangedError } from '@patrimonio/application';
import type { PriceQuote } from '@patrimonio/application';
import { failure, success } from '@patrimonio/shared';
import type { Either } from '@patrimonio/shared';

import { FormatChanged } from '../support/format.js';
import { parseRecord } from './layout.js';

/**
 * A leitura do COTAHIST, em streaming. O arquivo anual tem algumas centenas de
 * megabytes e mais de um milhão de linhas: carregá-lo em memória para depois
 * filtrar é a diferença entre terminar e não terminar.
 *
 * A entrada é um iterável de linhas, não um caminho. Em teste são três strings;
 * em produção é o arquivo aberto por `readLines`. É o mesmo motivo de `fetch`
 * entrar por parâmetro nos provedores.
 *
 * ## O que é filtrado, e por quem
 *
 * O leitor devolve só cotação a vista, e só dos papéis pedidos. Filtrar aqui, e
 * não depois, é o que mantém o uso de memória proporcional à carteira em vez de
 * ao arquivo: trinta ativos em dez anos são umas 75 mil linhas, contra dez
 * milhões no arquivo.
 */
export const COTAHIST_SOURCE = 'cotahist';

export type CotahistReport = {
  readonly quotes: readonly PriceQuote[];
  readonly lines_read: number;
  readonly records_kept: number;
  /** Papéis pedidos que o arquivo não tem. */
  readonly missing: readonly string[];
  readonly first_date: string | null;
  readonly last_date: string | null;
};

export type ReadOptions = {
  /** Os papéis a extrair. Vazio devolve tudo, que só serve para inspeção. */
  readonly tickers: readonly string[];
  /** Recorte opcional: a carga inicial costuma querer dez anos, não trinta. */
  readonly from?: string | undefined;
  readonly to?: string | undefined;
};

export const readCotahist = async (
  lines: AsyncIterable<string> | Iterable<string>,
  options: ReadOptions,
): Promise<Either<FormatChangedError, CotahistReport>> => {
  const wanted = new Set(options.tickers.map((ticker) => ticker.toUpperCase()));
  const everything = wanted.size === 0;

  const quotes: PriceQuote[] = [];
  const seen = new Set<string>();

  let lineNumber = 0;
  let kept = 0;
  let first: string | null = null;
  let last: string | null = null;

  try {
    for await (const line of lines) {
      lineNumber += 1;

      const record = parseRecord(line, lineNumber);
      if (record === null) continue;

      if (!everything && !wanted.has(record.ticker)) continue;
      if (options.from !== undefined && record.trade_date < options.from) continue;
      if (options.to !== undefined && record.trade_date > options.to) continue;

      // O mesmo papel aparece em mais de um grupo no mesmo dia — lote padrão e
      // fracionário. O primeiro vale; o segundo duplicaria a chave
      // (asset, data), e reimportar o ano não pode mudar nada.
      const key = `${record.ticker}\u0000${record.trade_date}`;
      if (seen.has(key)) continue;
      seen.add(key);

      kept += 1;

      if (first === null || record.trade_date < first) first = record.trade_date;
      if (last === null || record.trade_date > last) last = record.trade_date;

      quotes.push({
        ticker: record.ticker,
        price_date: record.trade_date,
        close: record.close,
      });
    }
  } catch (error) {
    if (error instanceof FormatChanged) {
      return failure(
        new FormatChangedError(
          COTAHIST_SOURCE,
          error.field,
          error.reason,
          String(error.received).slice(0, 500),
        ),
      );
    }

    throw error;
  }

  const found = new Set(quotes.map((quote) => quote.ticker));

  return success({
    quotes,
    lines_read: lineNumber,
    records_kept: kept,
    missing: [...wanted].filter((ticker) => !found.has(ticker)),
    first_date: first,
    last_date: last,
  });
};

/**
 * O arquivo em disco, linha por linha. O COTAHIST é distribuído em ZIP: o
 * arquivo precisa estar extraído, e isto não tenta descompactar — falhar aqui
 * com "extraia o arquivo" é melhor do que carregar uma dependência de
 * descompactação para uma operação que acontece uma vez por ano.
 */
export const readLines = (path: string): AsyncIterable<string> =>
  createInterface({
    input: createReadStream(path, { encoding: 'latin1' }),
    crlfDelay: Number.POSITIVE_INFINITY,
  });
