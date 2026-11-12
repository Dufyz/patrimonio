import { financeClock, financeUseCases } from '@patrimonio/application';
import type { Clock } from '@patrimonio/application';
import {
  closeDatabase,
  createConnection,
  createUnitOfWork,
  loadFinanceDemo,
  removeFinanceDemo,
  runMigrations,
} from '@patrimonio/db';
import type { Sql } from '@patrimonio/db';
import { environment } from '@patrimonio/env';
import { uuidV7 } from '@patrimonio/shared';
import { unwrapSuccess } from '@patrimonio/shared/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

/**
 * A rotina diária de Finanças contra Postgres real. O relógio é fixo; o que se
 * mede é que rodar de novo, no mesmo dia ou no dia seguinte, não duplica nada.
 */
let sql: Sql;

const at = (iso: string): Clock => ({
  now: () => new Date(iso),
  today: () => iso.slice(0, 10) as never,
});

const sync = (iso: string) =>
  financeUseCases({
    unitOfWork: createUnitOfWork(sql),
    clock: financeClock(at(iso)),
    newId: () => uuidV7(),
  }).syncDaily();

const count = async (query: string): Promise<number> => {
  const [row] = await sql.unsafe<{ n: string }[]>(
    `SELECT COUNT(*)::TEXT AS n FROM (${query}) q`,
  );
  return Number(row?.n ?? 0);
};

beforeAll(async () => {
  await runMigrations(environment.database.connection);
  sql = createConnection({
    connection: environment.database.connection,
    poolSize: 4,
    applicationName: 'patrimonio-finance-stage-test',
  });
});

afterAll(async () => {
  await removeFinanceDemo(sql);
  await closeDatabase(sql);
});

beforeEach(async () => {
  await removeFinanceDemo(sql);
  await loadFinanceDemo(sql);
});

describe('estágio finance', () => {
  it('gera o previsto do mês e lança o automático cuja data chegou', async () => {
    const result = await sync('2026-11-05T12:00:00.000Z');
    unwrapSuccess(result);

    // Salário (automático, dia 5) vira lançado em 05/11.
    const salary = await count(`
      SELECT 1 FROM fin_entry e JOIN fin_recurring r ON r.id = e.recurring_id
       WHERE r.name = 'Salário' AND e.date = '2026-11-05' AND e.status = 'LANCADA'`);
    expect(salary).toBe(1);

    // Manual (freela, dia 12) fica previsto: só o usuário confirma.
    const freela = await count(`
      SELECT 1 FROM fin_entry e JOIN fin_recurring r ON r.id = e.recurring_id
       WHERE r.name LIKE 'Freela%' AND e.date = '2026-11-12' AND e.status = 'PREVISTA'`);
    expect(freela).toBe(1);
  });

  it('rodar de novo no mesmo dia e no dia seguinte não duplica previstos nem créditos', async () => {
    unwrapSuccess(await sync('2026-11-05T12:00:00.000Z'));
    const entries = await count('SELECT 1 FROM fin_entry');
    const credits = await count(`SELECT 1 FROM fin_movement WHERE kind = 'CREDITO'`);

    unwrapSuccess(await sync('2026-11-05T12:00:00.000Z'));
    unwrapSuccess(await sync('2026-11-06T12:00:00.000Z'));

    expect(await count('SELECT 1 FROM fin_entry')).toBe(entries);
    expect(await count(`SELECT 1 FROM fin_movement WHERE kind = 'CREDITO'`)).toBe(
      credits,
    );
  });

  it('credita o benefício do mês uma única vez', async () => {
    unwrapSuccess(await sync('2026-11-10T12:00:00.000Z'));
    unwrapSuccess(await sync('2026-11-10T13:00:00.000Z'));
    const november = await count(`
      SELECT 1 FROM fin_movement WHERE kind = 'CREDITO' AND date >= '2026-11-01' AND date < '2026-12-01'`);
    // Dois benefícios na demonstração, um crédito cada, neste mês.
    expect(november).toBe(2);
  });

  it('a conta do dia é a de São Paulo: 23h de 05/11 em SP já é 06/11 em UTC', async () => {
    unwrapSuccess(await sync('2026-11-06T02:00:00.000Z'));
    const premature = await count(`
      SELECT 1 FROM fin_entry e JOIN fin_recurring r ON r.id = e.recurring_id
       WHERE r.name = 'Salário' AND e.date = '2026-11-06' AND e.status = 'LANCADA'`);
    expect(premature).toBe(0);
  });
});
