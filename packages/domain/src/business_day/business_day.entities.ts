import type { DateOnly } from '../support/date_only.js';

/**
 * O calendário da B3 em tabela, não em biblioteca: feriado bancário não é
 * derivável de regra, e a marcação na curva pró-rata conta dia útil, não dia
 * corrido.
 *
 * As duas colunas de feriado existem porque as duas contagens divergem — a
 * quinta-feira de Corpus Christi fecha os dois, mas um feriado estadual pode
 * fechar o pregão e não o banco.
 */
export type BusinessDay = {
  readonly calendar_date: DateOnly;
  /** Dia de pregão na B3: é o que a série e a curva usam. */
  readonly is_business_day: boolean;
  readonly is_bank_holiday: boolean;
  readonly is_trading_holiday: boolean;
  readonly holiday_name: string | null;
};
