import { FormatChangedError } from '@patrimonio/application';
import type { DateOnly, InstrumentType } from '@patrimonio/domain';
import { failure, success } from '@patrimonio/shared';
import type { Either } from '@patrimonio/shared';

import { FormatChanged } from '../support/format.js';
import { parseInstrumentRecord } from './layout.js';
import { COTAHIST_SOURCE } from './reader.js';

export type CotahistInstrument = {
  readonly ticker: string;
  readonly name: string;
  readonly b3_type: InstrumentType;
  /** O último pregão em que o papel apareceu no arquivo. */
  readonly last_trade_date: DateOnly;
};

export type CotahistInstruments = {
  readonly instruments: readonly CotahistInstrument[];
  readonly lines_read: number;
  readonly first_date: DateOnly | null;
  readonly last_date: DateOnly | null;
};

/**
 * Os papéis de um arquivo do COTAHIST: um por ticker, com o nome e a data do
 * último pregão. Em memória fica um registro por papel — alguns milhares —, e
 * não por linha: o arquivo anual tem milhões.
 *
 * O nome é o da última linha em que o papel aparece, que é o vigente quando a
 * empresa troca de razão social no meio do ano.
 */
export const readCotahistInstruments = async (
  lines: AsyncIterable<string> | Iterable<string>,
): Promise<Either<FormatChangedError, CotahistInstruments>> => {
  const byTicker = new Map<string, CotahistInstrument>();
  let lineNumber = 0;
  let first: DateOnly | null = null;
  let last: DateOnly | null = null;

  try {
    for await (const line of lines) {
      lineNumber += 1;

      const record = parseInstrumentRecord(line, lineNumber);
      if (record === null) continue;

      if (first === null || record.trade_date < first) first = record.trade_date;
      if (last === null || record.trade_date > last) last = record.trade_date;

      const known = byTicker.get(record.ticker);
      if (known !== undefined && known.last_trade_date > record.trade_date) continue;

      byTicker.set(record.ticker, {
        ticker: record.ticker,
        name: record.name,
        b3_type: record.b3_type,
        last_trade_date: record.trade_date,
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

  return success({
    instruments: [...byTicker.values()].sort((a, b) => a.ticker.localeCompare(b.ticker)),
    lines_read: lineNumber,
    first_date: first,
    last_date: last,
  });
};
