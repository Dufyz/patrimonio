import type { DateOnly } from '../support/date_only.js';

export const INSTRUMENT_TYPES = ['stock', 'fii', 'etf', 'bdr', 'treasury'] as const;

export type InstrumentType = (typeof INSTRUMENT_TYPES)[number];

/**
 * Um papel que existe no mercado, tenha a pessoa negociado ou não. O catálogo é
 * escrito só pela carga: a API o lê, e o ativo da carteira nasce dele no
 * primeiro lançamento.
 *
 * `active` é falso para o papel que a fonte deixou de negociar. Ele continua no
 * catálogo para quem o teve; a busca o esconde por padrão.
 */
export type ListedInstrument = {
  readonly id: string;
  readonly ticker: string;
  readonly name: string;
  readonly b3_type: InstrumentType;
  /** Só o título do Tesouro tem vencimento. */
  readonly maturity_date: DateOnly | null;
  readonly source: string;
  readonly active: boolean;
  readonly last_trade_date: DateOnly | null;
  readonly created_at: string;
  readonly updated_at: string;
};

export const isInstrumentType = (value: unknown): value is InstrumentType =>
  typeof value === 'string' && (INSTRUMENT_TYPES as readonly string[]).includes(value);
