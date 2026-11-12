import type { Clock } from '../../interfaces/clock.js';

const SAO_PAULO = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * "Hoje" de Finanças é o dia de quem usa, em São Paulo: depois das 21h o dia em
 * UTC já virou, e o previsto de amanhã não pode ser tratado como de hoje.
 * Derivado de `clock.now()`, então o relógio fixo dos testes continua valendo.
 */
export const financeClock = (clock: Clock): Clock => ({
  now: clock.now,
  today: () => SAO_PAULO.format(clock.now()) as ReturnType<Clock['today']>,
});
