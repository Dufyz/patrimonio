import {
  closeDatabase,
  createConnection,
  createRepositories,
  createUnitOfWork,
  runMigrations,
} from '@patrimonio/db';
import type { Sql } from '@patrimonio/db';
import { dedupeKey } from '@patrimonio/domain';
import { environment } from '@patrimonio/env';
import {
  closeQueues,
  closeRedisConnection,
  createQueues,
  createRedisConnection,
} from '@patrimonio/queue';
import type { Queues, RedisConnection } from '@patrimonio/queue';
import type { Clock, UnitOfWork } from '@patrimonio/application';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { runRelayOnce } from '../infra/relay.js';
import { logger } from '../infra/logger.js';
import { cdiSeries } from '../testing/market.js';
import { stageUseCases } from '../testing/stage-usecases.js';
import type { StageDeps } from '../infra/define-stage.js';
import { closeStage } from './close.stage.js';
import { marketStage } from './market.stage.js';

/**
 * **O critério de saída de E4**: uma semana inteira de coleta automática sem
 * intervenção, com a saúde do dado visível.
 *
 * Este teste atravessa o caminho de verdade — outbox, relay, Redis, fila, job —
 * para cinco dias úteis seguidos, com Postgres e Redis reais e só as fontes
 * roteirizadas. É o mais perto que se chega do critério sem esperar uma semana
 * de calendário, e o que ele prova é o que importa: a corrente
 * `market → close` fecha sozinha, todo dia, e o patrimônio de cada dia sai de
 * preço coletado naquele dia.
 */
const PORTFOLIO = '0191e5a0-0000-7000-8000-0000000a0001';
const INSTITUTION = '0191e5a0-0000-7000-8000-0000000a0002';
const ACAO = '0191e5a0-0000-7000-8000-0000000a0003';
const CDB = '0191e5a0-0000-7000-8000-0000000a0004';

/** Uma semana de pregão: 28/09 a 02/10 de 2026, segunda a sexta. */
const SEMANA = [
  '2026-09-28',
  '2026-09-29',
  '2026-09-30',
  '2026-10-01',
  '2026-10-02',
] as const;

/** O preço sobe um real por dia: a série fica conferível a olho. */
const PRECO = ['30.00', '31.00', '32.00', '33.00', '34.00'] as const;

let sql: Sql;
let redis: RedisConnection;
let queues: Queues;
let unitOfWork: UnitOfWork;

const limpar = async (): Promise<void> => {
  await sql`DELETE FROM asset_price`;
  await sql`DELETE FROM index_quote`;
  await sql`DELETE FROM market_source_run`;
  await sql`DELETE FROM position_daily`;
  await sql`DELETE FROM portfolio_daily`;
  await sql`DELETE FROM realized_result`;
  await sql`DELETE FROM alert_instance`;
  await sql`DELETE FROM pipeline_outbox`;
  await sql`DELETE FROM transaction`;
  await sql`DELETE FROM asset WHERE id IN (${ACAO}, ${CDB})`;
  await sql`DELETE FROM portfolio WHERE id = ${PORTFOLIO}`;
  await sql`DELETE FROM institution WHERE id = ${INSTITUTION}`;
};

const waitFor = async (
  condition: () => Promise<boolean>,
  timeoutMs = 20_000,
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error('a condição não aconteceu no tempo esperado');
};

beforeAll(async () => {
  await runMigrations(environment.database.connection);

  sql = createConnection({
    connection: environment.database.connection,
    poolSize: 6,
    applicationName: 'patrimonio-semana-test',
  });
  redis = createRedisConnection(environment.redis.url);
  queues = createQueues(redis);
  unitOfWork = createUnitOfWork(sql);
});

afterAll(async () => {
  await limpar();
  await closeQueues(queues);
  await closeRedisConnection(redis);
  await closeDatabase(sql);
});

beforeEach(async () => {
  await limpar();
  await Promise.all(
    Object.values(queues).map((queue) => queue.obliterate({ force: true })),
  );

  await sql`
    INSERT INTO institution (id, name)
    VALUES (${INSTITUTION}, 'Corretora Semana')
  `;
  await sql`INSERT INTO portfolio (id, name) VALUES (${PORTFOLIO}, 'Carteira Semana')`;
  await sql`
    INSERT INTO asset (id, ticker, name, origin, b3_type, price_source)
    VALUES (${ACAO}, 'SEMA4', 'Ação da semana', 'market', 'stock', 'auto')
  `;
  await sql`
    INSERT INTO asset (
      id, ticker, name, origin, b3_type, issuer_id, indexer, rate, issued_at,
      maturity_date, liquidity, tax_regime
    )
    VALUES (
      ${CDB}, 'SEM-CDB-2028', 'CDB da semana', 'manual', NULL, ${INSTITUTION},
      'cdi_pct', 112, '2026-09-25', '2028-10-10', 'at_maturity', 'regressive'
    )
  `;

  // Compra na sexta anterior: a semana inteira tem posição aberta nos dois.
  await sql`
    INSERT INTO transaction (
      id, kind, trade_date, settlement_date, portfolio_id, asset_id, institution_id,
      quantity, unit_price, fees, gross_amount, net_amount
    )
    VALUES
      ('0191e5a0-0000-7000-8000-0000000b0001', 'buy', '2026-09-25', '2026-09-25',
       ${PORTFOLIO}, ${ACAO}, ${INSTITUTION}, 100, 29, 0, 2900, -2900),
      ('0191e5a0-0000-7000-8000-0000000b0002', 'buy', '2026-09-25', '2026-09-25',
       ${PORTFOLIO}, ${CDB}, ${INSTITUTION}, 1, 10000, 0, 10000, -10000)
  `;
});

/**
 * A série do CDI do mês até o dia. Ela precisa começar no primeiro do mês, e não
 * no dia: a curva do CDB conta dias úteis desde a aplicação, e um buraco na
 * série marca a linha como `stale` — que é o comportamento certo, e é o que
 * acontece se o teste alimentar só o dia corrente.
 */
const mesAte = (day: string): readonly string[] => {
  const dias: string[] = [];
  const cursor = new Date(`${day.slice(0, 7)}-01T00:00:00.000Z`);
  const fim = new Date(`${day}T00:00:00.000Z`);

  while (cursor <= fim) {
    dias.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return dias;
};

const depsFor = (day: string, index: number): StageDeps => {
  const clock: Clock = {
    now: () => new Date(`${day}T21:30:00.000Z`),
    today: () => day,
  };

  return {
    connection: redis,
    unitOfWork,
    outbox: createRepositories(sql).outbox,
    clock,
    logger,
    usecases: stageUseCases(unitOfWork, clock, {
      quotes: [{ ticker: 'SEMA4', price_date: day, close: PRECO[index] ?? '30.00' }],
      indices: cdiSeries(mesAte(day) as never),
    }),
  };
};

describe('critério de saída do épico', () => {
  it('cinco dias de coleta automática fecham sozinhos, pela corrente market → close', async () => {
    for (const [index, day] of SEMANA.entries()) {
      const deps = depsFor(day, index);

      // O dia começa como o agendamento o começa: um evento na outbox.
      const enqueued = await createRepositories(sql).outbox.enqueue([
        {
          stage: 'market',
          dedupe_key: dedupeKey.market(day),
          payload: { reference_date: day },
        },
      ]);
      expect(enqueued.isSuccess()).toBe(true);

      const market = marketStage(deps);
      const close = closeStage(deps);

      try {
        // Duas passadas do relay: a primeira despacha a coleta, a segunda o
        // fechamento que a coleta encadeou.
        await runRelayOnce({
          unitOfWork,
          queues,
          logger,
          pollMs: 50,
          batchSize: 10,
        });

        await waitFor(async () => {
          const [row] = await sql<{ completed_at: Date | null }[]>`
              SELECT completed_at FROM pipeline_outbox
               WHERE dedupe_key = ${dedupeKey.market(day)}
            `;

          return row?.completed_at !== null && row?.completed_at !== undefined;
        });

        await runRelayOnce({
          unitOfWork,
          queues,
          logger,
          pollMs: 50,
          batchSize: 10,
        });

        await waitFor(async () => {
          const [row] = await sql<{ total: string }[]>`
              SELECT COUNT(*)::TEXT AS total FROM portfolio_daily
               WHERE portfolio_id = ${PORTFOLIO} AND position_date = ${day}
            `;

          return Number(row?.total ?? 0) > 0;
        });
      } finally {
        await market.close();
        await close.close();
      }
    }

    // ── A série da semana ────────────────────────────────────────────────────
    const precos = await sql<{ price_date: string; close: string }[]>`
        SELECT price_date, close FROM asset_price
         WHERE asset_id = ${ACAO} ORDER BY price_date
      `;

    expect(precos.map((row) => row.price_date)).toEqual([...SEMANA]);

    const dias = await sql<
      { position_date: string; total_value: string; quota_value: string }[]
    >`
        SELECT position_date, total_value, quota_value
          FROM portfolio_daily
         WHERE portfolio_id = ${PORTFOLIO}
         ORDER BY position_date
      `;

    // Cinco dias, um por dia útil, sem buraco.
    expect(dias.map((row) => row.position_date)).toEqual([...SEMANA]);

    // Nenhum zero e nenhum NaN: o patrimônio de cada dia é um número.
    expect(dias.every((row) => Number(row.total_value) > 0)).toBe(true);
    expect(dias.every((row) => Number(row.quota_value) > 0)).toBe(true);

    // O patrimônio sobe com o preço, e o CDB acrua junto.
    const valores = dias.map((row) => Number(row.total_value));
    expect(valores).toEqual([...valores].sort((left, right) => left - right));

    // ── A saúde do dado ─────────────────────────────────────────────────────
    const posicoes = await sql<{ price_source_kind: string; total: string }[]>`
        SELECT price_source_kind, COUNT(*)::TEXT AS total
          FROM position_daily
         WHERE portfolio_id = ${PORTFOLIO}
         GROUP BY price_source_kind
      `;

    // Dez linhas — dois papéis em cinco dias — e todas confiáveis: preço do
    // próprio dia na ação, curva sem buraco no CDB.
    expect(posicoes).toEqual([{ price_source_kind: 'fresh', total: '10' }]);

    // ── O registro da coleta ────────────────────────────────────────────────
    const coletas = await sql<{ source: string; kind: string; ok: boolean }[]>`
        SELECT source, kind, ok FROM market_source_run ORDER BY started_at, kind
      `;

    // Três fontes por dia, cinco dias, todas bem.
    expect(coletas).toHaveLength(15);
    expect(coletas.every((row) => row.ok)).toBe(true);

    // ── E nenhum evento ficou pendente ou falhado ───────────────────────────
    const pendentes = await sql<{ total: string }[]>`
        SELECT COUNT(*)::TEXT AS total FROM pipeline_outbox
         WHERE stage IN ('market', 'close') AND completed_at IS NULL
      `;
    expect(Number(pendentes[0]?.total)).toBe(0);
  }, 120_000);
});
