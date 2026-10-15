import { addDays } from '@patrimonio/domain';
import type { DateOnly } from '@patrimonio/domain';
import { success } from '@patrimonio/shared';
import type { Either } from '@patrimonio/shared';

import type { AppError } from '../../errors/app-error.js';
import type { TransactionalRepositories } from '../../interfaces/unit-of-work.js';

/** Quantos dias para trás procurar: cobre o maior feriado prolongado com folga. */
const LOOKBACK_DAYS = 10;

/**
 * O último pregão até `today`, inclusive. É a "data de hoje" de tudo que fala de
 * preço: no domingo não há cotação do dia, há a de sexta, e pedir ou cobrar a
 * de domingo produz alarme falso (cobrança) ou coleta vazia (pedido).
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
    today,
  );
  if (calendar.isFailure()) return calendar;

  const last = calendar.value
    .filter((day) => day.is_business_day)
    .map((day) => day.calendar_date)
    .sort()
    .at(-1);

  return success(last ?? today);
};
