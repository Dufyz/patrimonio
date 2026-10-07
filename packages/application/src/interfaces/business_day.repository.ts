import type { BusinessDay, DateOnly } from '@patrimonio/domain';
import type { Either } from '@patrimonio/shared';

import type { AppError } from '../errors/app-error.js';

/**
 * Dia útil vem do calendário da B3 em tabela, nunca de regra: feriado bancário
 * não é derivável, e a marcação na curva pró-rata depende da contagem exata.
 */
export type BusinessDayRepository = {
  readonly listBetween: (
    from: DateOnly,
    to: DateOnly,
  ) => Promise<Either<AppError, BusinessDay[]>>;

  /** Dias úteis no intervalo, incluindo as duas pontas quando são úteis. */
  readonly countBetween: (
    from: DateOnly,
    to: DateOnly,
  ) => Promise<Either<AppError, number>>;

  readonly isBusinessDay: (date: DateOnly) => Promise<Either<AppError, boolean>>;

  readonly nextBusinessDay: (
    date: DateOnly,
  ) => Promise<Either<AppError, DateOnly | null>>;

  readonly previousBusinessDay: (
    date: DateOnly,
  ) => Promise<Either<AppError, DateOnly | null>>;

  /**
   * A data de liquidação sugerida: D+2 em ação, D+1 em Tesouro, D+0 em título
   * bancário. Conta dia útil, não dia corrido — uma compra na sexta liquida na
   * terça, e numa semana com feriado liquida depois.
   */
  readonly shiftBusinessDays: (
    date: DateOnly,
    days: number,
  ) => Promise<Either<AppError, DateOnly>>;
};
