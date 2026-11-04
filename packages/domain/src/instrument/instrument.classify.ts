import type { InstrumentType } from './instrument.entities.js';

/**
 * O tipo de um papel do COTAHIST, pelo grupo (`CODBDI`) e pela especificação
 * (`ESPECI`). O sufixo do ticker não decide sozinho: 3, 4, 5, 6 e 11 aparecem em
 * ação, em unit, em FII e em ETF.
 *
 * | CODBDI | ESPECI | Tipo |
 * | --- | --- | --- |
 * | 12 | qualquer | FII |
 * | 14 | `CI*` | ETF |
 * | 34, 35, 36 | `DR*` | BDR |
 * | 02 | `CI*` | ETF |
 * | 02, 07, 08 | `ON`, `OR`, `PN*`, `PR*`, `UNT` | ação ou unit |
 *
 * O 07 e o 08 são o lote padrão de empresa em recuperação judicial ou
 * extrajudicial: o papel é o mesmo e continua sendo negociado.
 *
 * Qualquer outro grupo (fracionário, termo, opção, direito, bônus) fica fora do
 * catálogo, e a função devolve `null`. O fracionário é o mesmo papel com um `F`
 * no fim do código: listá-lo duplicaria cada ticker.
 */
const STANDARD_LOT = '02';
const STOCK_GROUPS: readonly string[] = [STANDARD_LOT, '07', '08'];
const REAL_ESTATE_FUNDS = '12';
const FUND_SHARES = '14';
const BDR_GROUPS: readonly string[] = ['34', '35', '36'];

const STOCK_SPECIES = /^(ON|OR|PN|PR|UNT)/u;

export const classifyListedInstrument = (input: {
  readonly codbdi: string;
  readonly especi: string;
}): InstrumentType | null => {
  const species = input.especi.trim().toUpperCase().split(/\s+/u)[0] ?? '';

  if (input.codbdi === REAL_ESTATE_FUNDS) return 'fii';
  if (input.codbdi === FUND_SHARES) return species === 'CI' ? 'etf' : null;
  if (BDR_GROUPS.includes(input.codbdi)) return species.startsWith('DR') ? 'bdr' : null;
  if (!STOCK_GROUPS.includes(input.codbdi)) return null;

  if (species === 'CI' && input.codbdi === STANDARD_LOT) return 'etf';
  if (species.startsWith('DR') && input.codbdi === STANDARD_LOT) return 'bdr';
  if (STOCK_SPECIES.test(species)) return 'stock';

  return null;
};
