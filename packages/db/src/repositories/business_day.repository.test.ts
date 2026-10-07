import { unwrapFailure, unwrapSuccess } from '@patrimonio/shared/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeDatabase } from '../postgresql.js';
import type { Sql } from '../postgresql.js';
import { createTestConnection, prepareTestDatabase } from '../testing/database.js';
import { createBusinessDayRepository } from './business_day.repository.js';

let sql: Sql;
let businessDays: ReturnType<typeof createBusinessDayRepository>;

beforeAll(async () => {
  sql = createTestConnection();
  await prepareTestDatabase(sql);
  // Só leitura: o calendário é carregado uma vez e nenhum teste o altera.
  businessDays = createBusinessDayRepository(sql);
});

afterAll(async () => {
  await closeDatabase(sql);
});

describe('calendário de dias úteis', () => {
  it('janeiro de 2024 tem 22 dias úteis, com o dia 1º fora', async () => {
    const total = unwrapSuccess(
      await businessDays.countBetween('2024-01-01', '2024-01-31'),
    );

    expect(total).toBe(22);
  });

  it('a contagem inclui as duas pontas quando são dias úteis', async () => {
    // Quarta a sexta da mesma semana, sem feriado.
    expect(
      unwrapSuccess(await businessDays.countBetween('2024-01-10', '2024-01-12')),
    ).toBe(3);
    expect(
      unwrapSuccess(await businessDays.countBetween('2024-01-10', '2024-01-10')),
    ).toBe(1);
  });

  it('o Carnaval não é dia de pregão, e a quarta-feira seguinte é', async () => {
    expect(unwrapSuccess(await businessDays.isBusinessDay('2024-02-12'))).toBe(false);
    expect(unwrapSuccess(await businessDays.isBusinessDay('2024-02-13'))).toBe(false);
    expect(unwrapSuccess(await businessDays.isBusinessDay('2024-02-14'))).toBe(true);
  });

  it('24 e 31 de dezembro são dia bancário sem pregão', async () => {
    const [christmasEve] = unwrapSuccess(
      await businessDays.listBetween('2024-12-24', '2024-12-24'),
    );

    expect(christmasEve?.is_business_day).toBe(false);
    expect(christmasEve?.is_trading_holiday).toBe(true);
    expect(christmasEve?.is_bank_holiday).toBe(false);
  });

  it('o dia seguinte a uma sexta-feira é a segunda, pulando o fim de semana', async () => {
    expect(unwrapSuccess(await businessDays.nextBusinessDay('2024-01-12'))).toBe(
      '2024-01-15',
    );
  });

  it('o dia útil anterior à Paixão de Cristo é a quinta-feira', async () => {
    expect(unwrapSuccess(await businessDays.previousBusinessDay('2024-03-29'))).toBe(
      '2024-03-28',
    );
    expect(unwrapSuccess(await businessDays.nextBusinessDay('2024-03-28'))).toBe(
      '2024-04-01',
    );
  });

  it('o calendário cobre de 2000 a 2035', async () => {
    const [first] = unwrapSuccess(
      await businessDays.listBetween('2000-01-01', '2000-01-01'),
    );
    const [last] = unwrapSuccess(
      await businessDays.listBetween('2035-12-31', '2035-12-31'),
    );

    expect(first?.calendar_date).toBe('2000-01-01');
    expect(last?.calendar_date).toBe('2035-12-31');
  });

  it('data fora do calendário carregado falha em vez de chutar', async () => {
    const error = unwrapFailure(await businessDays.isBusinessDay('1998-05-04'));

    expect(error.statusCode).toBe(500);
  });

  it('a data volta como string YYYY-MM-DD, nunca como Date com fuso', async () => {
    const [day] = unwrapSuccess(
      await businessDays.listBetween('2024-03-10', '2024-03-10'),
    );

    expect(day?.calendar_date).toBe('2024-03-10');
    expect(typeof day?.calendar_date).toBe('string');
  });
});
