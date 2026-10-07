import type { DateOnly } from '@patrimonio/domain';

/**
 * As regras que geram o calendário. Ficam versionadas aqui, e o JSON gerado a
 * partir delas (`business_days.json`) é o que entra no banco — assim a seed é
 * revisável linha a linha e a regra que a produziu também.
 *
 * Duas contagens convivem:
 *
 *  · feriado bancário — a lista da ANBIMA, que o CDI e a curva usam;
 *  · feriado de pregão — quando a B3 não negocia.
 *
 * Elas divergem: 24 e 31 de dezembro são dia bancário sem pregão, e os feriados
 * municipais de São Paulo fecharam a B3 até 2021 sem nunca ter fechado banco.
 */

export type HolidayKind = 'bank' | 'trading' | 'both';

export type Holiday = {
  readonly date: DateOnly;
  readonly name: string;
  readonly kind: HolidayKind;
};

/** Domingo de Páscoa pelo algoritmo de Meeus/Jones/Butcher. */
export const easterSunday = (year: number): DateOnly => {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;

  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

const shift = (date: DateOnly, days: number): DateOnly => {
  const base = new Date(`${date}T00:00:00.000Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
};

const pad = (value: number): string => String(value).padStart(2, '0');

const FIXED_NATIONAL: ReadonlyArray<{ month: number; day: number; name: string }> = [
  { month: 1, day: 1, name: 'Confraternização Universal' },
  { month: 4, day: 21, name: 'Tiradentes' },
  { month: 5, day: 1, name: 'Dia do Trabalho' },
  { month: 9, day: 7, name: 'Independência' },
  { month: 10, day: 12, name: 'Nossa Senhora Aparecida' },
  { month: 11, day: 2, name: 'Finados' },
  { month: 11, day: 15, name: 'Proclamação da República' },
  { month: 12, day: 25, name: 'Natal' },
];

/**
 * Consciência Negra é feriado nacional desde 2024 (Lei 14.759/2023). Antes
 * disso a B3 já não negociava, por ser feriado municipal de São Paulo, até
 * 2021 — e voltou a negociar em 2022 e 2023.
 */
const BLACK_AWARENESS_NATIONAL_FROM = 2024;

/** A B3 observou os feriados municipais de São Paulo até o fim de 2021. */
const SAO_PAULO_OBSERVED_UNTIL = 2021;

/**
 * Onde a realidade divergiu da regra. É aqui que entra cada diferença
 * encontrada na conferência contra o calendário oficial da ANBIMA e o de
 * negociação da B3 — um dia de pregão suspenso por decisão da bolsa, um
 * feriado que caiu num ano e não no seguinte, uma lei nova.
 *
 * `kind: null` remove o feriado que a regra criou naquele dia.
 *
 * Esta lista existe para a correção ter um lugar permanente. Editar o JSON da
 * seed sem registrar o motivo aqui faz a próxima regeração desfazer a correção,
 * em silêncio.
 */
export const EXCEPTIONS: ReadonlyArray<{
  readonly date: DateOnly;
  readonly name: string;
  readonly kind: HolidayKind | null;
  readonly source: string;
}> = [
  // Exemplo da forma, comentado: sem conferência, nada entra aqui.
  // { date: '2014-06-12', name: 'Abertura da Copa (sem pregão)', kind: 'trading',
  //   source: 'Comunicado B3 de 2014-05-28' },
];

export const holidaysOf = (year: number): Holiday[] => {
  const easter = easterSunday(year);

  const holidays: Holiday[] = [
    ...FIXED_NATIONAL.map((entry) => ({
      date: `${year}-${pad(entry.month)}-${pad(entry.day)}`,
      name: entry.name,
      kind: 'both' as const,
    })),

    { date: shift(easter, -48), name: 'Carnaval', kind: 'both' },
    { date: shift(easter, -47), name: 'Carnaval', kind: 'both' },
    { date: shift(easter, -2), name: 'Paixão de Cristo', kind: 'both' },
    { date: shift(easter, 60), name: 'Corpus Christi', kind: 'both' },

    // Dia bancário, sem pregão.
    { date: `${year}-12-24`, name: 'Véspera de Natal (sem pregão)', kind: 'trading' },
    { date: `${year}-12-31`, name: 'Véspera de Ano Novo (sem pregão)', kind: 'trading' },
  ];

  if (year >= BLACK_AWARENESS_NATIONAL_FROM) {
    holidays.push({
      date: `${year}-11-20`,
      name: 'Consciência Negra',
      kind: 'both',
    });
  } else if (year <= SAO_PAULO_OBSERVED_UNTIL) {
    holidays.push({
      date: `${year}-11-20`,
      name: 'Consciência Negra (municipal, sem pregão)',
      kind: 'trading',
    });
  }

  if (year <= SAO_PAULO_OBSERVED_UNTIL) {
    holidays.push(
      {
        date: `${year}-01-25`,
        name: 'Aniversário de São Paulo (sem pregão)',
        kind: 'trading',
      },
      {
        date: `${year}-07-09`,
        name: 'Revolução Constitucionalista (sem pregão)',
        kind: 'trading',
      },
    );
  }

  return holidays;
};

export type CalendarRow = {
  readonly calendar_date: DateOnly;
  readonly is_business_day: boolean;
  readonly is_bank_holiday: boolean;
  readonly is_trading_holiday: boolean;
  readonly holiday_name: string | null;
};

export const FIRST_YEAR = 2000;
export const LAST_YEAR = 2035;

export type Exception = (typeof EXCEPTIONS)[number];

/** As exceções conferidas valem sobre a regra. */
export const withExceptions = (
  holidays: readonly Holiday[],
  exceptions: readonly Exception[],
  firstYear = FIRST_YEAR,
  lastYear = LAST_YEAR,
): Holiday[] => {
  const byDate = new Map<DateOnly, Holiday>(
    holidays.map((holiday) => [holiday.date, holiday]),
  );

  for (const exception of exceptions) {
    const year = Number(exception.date.slice(0, 4));
    if (year < firstYear || year > lastYear) continue;

    if (exception.kind === null) byDate.delete(exception.date);
    else {
      byDate.set(exception.date, {
        date: exception.date,
        name: exception.name,
        kind: exception.kind,
      });
    }
  }

  return [...byDate.values()].sort((left, right) =>
    left.date < right.date ? -1 : left.date > right.date ? 1 : 0,
  );
};

/**
 * A lista de feriados que as regras produzem, de ponta a ponta do período, com
 * as divergências conferidas já aplicadas.
 */
export const holidaysBetween = (
  firstYear = FIRST_YEAR,
  lastYear = LAST_YEAR,
): Holiday[] => {
  const byDate = new Map<DateOnly, Holiday>();

  for (let year = firstYear; year <= lastYear; year += 1) {
    for (const holiday of holidaysOf(year)) {
      const existing = byDate.get(holiday.date);
      // Quando duas regras caem no mesmo dia, vale a mais abrangente.
      if (existing === undefined || existing.kind !== 'both') {
        byDate.set(holiday.date, holiday);
      }
    }
  }

  return withExceptions([...byDate.values()], EXCEPTIONS, firstYear, lastYear);
};

/**
 * Expande a lista de feriados no calendário dia a dia. `is_business_day` é dia
 * de pregão na B3, que é o que a série e a marcação na curva usam.
 *
 * A lista entra como parâmetro porque o que vale em produção é o JSON da seed:
 * uma correção da ANBIMA se resolve editando o arquivo, não o código.
 */
export const buildCalendarFromHolidays = (
  holidays: readonly Holiday[],
  firstYear = FIRST_YEAR,
  lastYear = LAST_YEAR,
): CalendarRow[] => {
  const byDate = new Map<DateOnly, Holiday>(
    holidays.map((holiday) => [holiday.date, holiday]),
  );

  const rows: CalendarRow[] = [];
  const cursor = new Date(`${firstYear}-01-01T00:00:00.000Z`);
  const end = new Date(`${lastYear}-12-31T00:00:00.000Z`);

  while (cursor <= end) {
    const date = cursor.toISOString().slice(0, 10);
    const weekday = cursor.getUTCDay();
    const isWeekend = weekday === 0 || weekday === 6;
    const holiday = byDate.get(date);

    const isBankHoliday =
      holiday !== undefined && (holiday.kind === 'bank' || holiday.kind === 'both');
    const isTradingHoliday =
      holiday !== undefined && (holiday.kind === 'trading' || holiday.kind === 'both');

    rows.push({
      calendar_date: date,
      is_business_day: !isWeekend && !isTradingHoliday,
      is_bank_holiday: isBankHoliday,
      is_trading_holiday: isTradingHoliday,
      holiday_name: holiday?.name ?? null,
    });

    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return rows;
};

/** O calendário que as regras produzem, sem passar pelo JSON. */
export const buildCalendar = (
  firstYear = FIRST_YEAR,
  lastYear = LAST_YEAR,
): CalendarRow[] =>
  buildCalendarFromHolidays(holidaysBetween(firstYear, lastYear), firstYear, lastYear);
