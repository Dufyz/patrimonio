import { isDateOnly } from '@patrimonio/domain';

import type { IsoDate } from './dates.js';
import type { DateRange } from './period.js';

/**
 * VGR-14.4 · O período de Finanças vai na URL como `?de=AAAA-MM-DD&ate=AAAA-MM-DD`,
 * para a tela recarregada e o endereço copiado mostrarem o mesmo recorte.
 * Valor inválido ou invertido não vale: a tela volta ao padrão.
 */
export const readRangeParams = (params: URLSearchParams): DateRange | null => {
  const from = params.get('de');
  const to = params.get('ate');
  if (from === null || to === null) return null;
  if (!isDateOnly(from) || !isDateOnly(to) || from > to) return null;
  return { from: from as IsoDate, to: to as IsoDate };
};

export const writeRangeParams = (
  params: URLSearchParams,
  range: DateRange,
  fallback: DateRange,
): URLSearchParams => {
  const next = new URLSearchParams(params);
  if (range.from === fallback.from && range.to === fallback.to) {
    next.delete('de');
    next.delete('ate');
  } else {
    next.set('de', range.from);
    next.set('ate', range.to);
  }
  return next;
};
