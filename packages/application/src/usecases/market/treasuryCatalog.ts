import { treasuryName, treasuryTicker } from '@patrimonio/domain';
import type { Either } from '@patrimonio/shared';
import { success } from '@patrimonio/shared';

import type { AppError } from '../../errors/app-error.js';
import type { InstrumentWrite } from '../../interfaces/instrument_catalog.repository.js';
import type { TreasuryQuote } from '../../interfaces/market_data.js';
import type { TransactionalRepositories } from '../../interfaces/unit-of-work.js';

export const TREASURY_CATALOG_SOURCE = 'tesouro-catalog';

/**
 * Os títulos à venda hoje, tal como a tabela de preços do Tesouro os publica.
 * O título que saiu da tabela — vencido ou retirado — deixa de ser ativo no
 * catálogo e continua nas posições de quem o teve.
 */
export const treasuryInstruments = (
  quotes: readonly TreasuryQuote[],
): readonly InstrumentWrite[] =>
  quotes.map((quote) => {
    const identity = {
      kind: quote.kind,
      coupon: quote.coupon,
      maturity_date: quote.maturity_date,
    };

    return {
      ticker: treasuryTicker(identity),
      name: treasuryName(identity),
      b3_type: 'treasury',
      maturity_date: quote.maturity_date,
      source: TREASURY_CATALOG_SOURCE,
      active: true,
      last_trade_date: quote.quote_date,
    };
  });

/**
 * Sem cotação não há catálogo para trocar: uma coleta vazia seria a fonte fora
 * do ar, e desativar todos os títulos por causa disso esconderia o Tesouro da
 * busca.
 */
export const writeTreasuryCatalog = async (
  repositories: TransactionalRepositories,
  quotes: readonly TreasuryQuote[],
): Promise<Either<AppError, null>> => {
  if (quotes.length === 0) return success(null);

  const rows = treasuryInstruments(quotes);

  const upserted = await repositories.instruments.upsertMany(rows);
  if (upserted.isFailure()) return upserted;

  const deactivated = await repositories.instruments.deactivateMissing(
    TREASURY_CATALOG_SOURCE,
    rows.map((row) => row.ticker),
  );
  if (deactivated.isFailure()) return deactivated;

  return success(null);
};
