import { addDays } from '@patrimonio/domain';
import type { DateOnly } from '@patrimonio/domain';
import { success } from '@patrimonio/shared';
import type { Either } from '@patrimonio/shared';

import type { AppError } from '../../errors/app-error.js';
import type { TransactionalRepositories } from '../../interfaces/unit-of-work.js';

/** Quantos dias para trás procurar: cobre o maior feriado prolongado com folga. */
const LOOKBACK_DAYS = 10;

/**
 * O último pregão ESTRITAMENTE ANTERIOR a `today` — o D-1. É a "data de hoje" de
 * tudo que fala de preço: o sistema trabalha só com fechamento, e o arquivo do
 * dia sai à noite. Na segunda-feira o D-1 é a sexta; num domingo, também.
 *
 * Calendário vazio devolve `today`: sem calendário carregado não há como saber,
 * e o comportamento anterior é o menos surpreendente.
 */
export const lastBusinessDay = async (
  repositories: TransactionalRepositories,
  today: DateOnly,
): Promise<Either<AppError, DateOnly>> => {
  const calendar = await repositories.businessDays.listBetween(
    addDays(today, -LOOKBACK_DAYS),
    addDays(today, -1),
  );
  if (calendar.isFailure()) return calendar;

  const last = calendar.value
    .filter((day) => day.is_business_day)
    .map((day) => day.calendar_date)
    .sort()
    .at(-1);

  return success(last ?? today);
};
