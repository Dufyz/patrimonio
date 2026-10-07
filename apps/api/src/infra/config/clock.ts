import type { Clock } from '@patrimonio/application';
import { toDateOnly } from '@patrimonio/domain';

/**
 * O único lugar da api que lê a hora. Tudo abaixo recebe a data por parâmetro,
 * o que torna o teste determinístico.
 */
export const systemClock: Clock = {
  now: () => new Date(),
  today: () => toDateOnly(new Date()),
};
