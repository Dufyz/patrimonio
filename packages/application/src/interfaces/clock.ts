import type { DateOnly } from '@patrimonio/domain';

/**
 * O relógio é parâmetro. Nenhuma função pura chama `new Date()`, e o container
 * injeta esta interface — em teste ela é fixa, o que permite simular um ano de
 * fechamentos em segundos e reproduzir bug de fronteira de mês ou de feriado.
 */
export type Clock = {
  readonly now: () => Date;
  readonly today: () => DateOnly;
};
