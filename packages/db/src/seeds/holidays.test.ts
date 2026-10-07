import { describe, expect, it } from 'vitest';

import { calendarFromSeed, readHolidaySeed } from './business_days.js';
import {
  EXCEPTIONS,
  FIRST_YEAR,
  LAST_YEAR,
  buildCalendar,
  easterSunday,
  holidaysBetween,
  withExceptions,
} from './holidays.js';

describe('Páscoa', () => {
  it.each([
    [2020, '2020-04-12'],
    [2021, '2021-04-04'],
    [2022, '2022-04-17'],
    [2023, '2023-04-09'],
    [2024, '2024-03-31'],
    [2025, '2025-04-20'],
    [2026, '2026-04-05'],
  ])('em %i cai em %s', (year, expected) => {
    expect(easterSunday(year)).toBe(expected);
  });
});

describe('calendário gerado', () => {
  const calendar = buildCalendar();
  const dayOf = (date: string) => calendar.find((row) => row.calendar_date === date);

  it('cobre o período inteiro dia a dia', () => {
    expect(calendar).toHaveLength(13_149);
    expect(calendar[0]?.calendar_date).toBe(`${FIRST_YEAR}-01-01`);
    expect(calendar.at(-1)?.calendar_date).toBe(`${LAST_YEAR}-12-31`);
  });

  it('feriado bancário e feriado de pregão estão distinguidos', () => {
    // Natal fecha os dois.
    expect(dayOf('2024-12-25')).toMatchObject({
      is_bank_holiday: true,
      is_trading_holiday: true,
      is_business_day: false,
    });

    // Véspera de Natal fecha só o pregão.
    expect(dayOf('2024-12-24')).toMatchObject({
      is_bank_holiday: false,
      is_trading_holiday: true,
      is_business_day: false,
    });
  });

  it('Consciência Negra virou feriado nacional em 2024', () => {
    expect(dayOf('2023-11-20')?.is_business_day).toBe(true);
    expect(dayOf('2024-11-20')).toMatchObject({
      is_bank_holiday: true,
      is_trading_holiday: true,
    });
  });

  it('a B3 observou os feriados municipais de São Paulo até 2021', () => {
    expect(dayOf('2021-01-25')?.is_business_day).toBe(false);
    expect(dayOf('2021-01-25')?.is_bank_holiday).toBe(false);
    // 25/01/2022 foi uma terça-feira, e a B3 negociou.
    expect(dayOf('2022-01-25')?.is_business_day).toBe(true);
  });

  it('fim de semana não é feriado, é só fim de semana', () => {
    const saturday = dayOf('2024-03-09');

    expect(saturday).toMatchObject({
      is_business_day: false,
      is_bank_holiday: false,
      is_trading_holiday: false,
      holiday_name: null,
    });
  });

  it('a contagem anual de pregões bate com o calendário da B3', () => {
    const tradingDays = (year: number) =>
      calendar.filter(
        (row) => row.calendar_date.startsWith(`${year}-`) && row.is_business_day,
      ).length;

    expect(tradingDays(2023)).toBe(249);
    expect(tradingDays(2024)).toBe(251);
    expect(tradingDays(2025)).toBe(250);
  });
});

describe('seed versionada', () => {
  it('o JSON do repositório é o que as regras produzem', async () => {
    const seed = await readHolidaySeed();

    expect(seed.first_year).toBe(FIRST_YEAR);
    expect(seed.last_year).toBe(LAST_YEAR);
    expect(seed.holidays).toEqual(holidaysBetween());
  });

  it('o calendário vem do JSON, e é igual ao das regras enquanto ninguém o editar', async () => {
    const fromSeed = await calendarFromSeed();

    expect(fromSeed).toEqual(buildCalendar());
  });
});

describe('divergências conferidas', () => {
  const regra = [
    { date: '2026-11-20', name: 'Consciência Negra', kind: 'both' as const },
    {
      date: '2026-12-24',
      name: 'Véspera de Natal (sem pregão)',
      kind: 'trading' as const,
    },
  ];

  it('uma exceção sobrescreve o que a regra produziu naquele dia', () => {
    const resultado = withExceptions(regra, [
      {
        date: '2026-12-24',
        name: 'Véspera de Natal (pregão só pela manhã)',
        kind: 'bank',
        source: 'teste',
      },
    ]);

    expect(resultado.find((dia) => dia.date === '2026-12-24')).toEqual({
      date: '2026-12-24',
      name: 'Véspera de Natal (pregão só pela manhã)',
      kind: 'bank',
    });
  });

  it('kind nulo remove o feriado que a regra criou', () => {
    const resultado = withExceptions(regra, [
      { date: '2026-11-20', name: 'não era feriado', kind: null, source: 'teste' },
    ]);

    expect(resultado.map((dia) => dia.date)).toEqual(['2026-12-24']);
  });

  it('uma exceção fora do período pedido é ignorada', () => {
    const resultado = withExceptions(
      regra,
      [{ date: '1998-05-04', name: 'antigo', kind: 'both', source: 'teste' }],
      2000,
      2035,
    );

    expect(resultado).toHaveLength(2);
  });

  it('acrescentar um dia que a regra não conhece entra na lista', () => {
    const resultado = withExceptions(regra, [
      { date: '2026-07-09', name: 'pregão suspenso', kind: 'trading', source: 'teste' },
    ]);

    expect(resultado.map((dia) => dia.date)).toEqual([
      '2026-07-09',
      '2026-11-20',
      '2026-12-24',
    ]);
  });

  it('a lista de exceções do projeto está vazia até a conferência acontecer', () => {
    // Quando a conferência contra a ANBIMA e a B3 encontrar divergência, esta
    // contagem muda — e o número aqui é o registro de que ela aconteceu.
    expect(EXCEPTIONS).toHaveLength(0);
  });
});
