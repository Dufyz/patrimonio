import { unwrapSuccess } from '@patrimonio/shared/testing';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { closeDatabase } from '../postgresql.js';
import type { Connection, Sql } from '../postgresql.js';
import {
  beginTestTransaction,
  createTestConnection,
  prepareTestDatabase,
  rollbackTestTransaction,
} from '../testing/database.js';
import type { TestTransaction } from '../testing/database.js';
import { createSettingsRepository } from './settings.repository.js';

const LONGO = '0191e5a0-0000-7000-8000-00000000e001';
const IMOVEL = '0191e5a0-0000-7000-8000-00000000e002';
const ANTIGA = '0191e5a0-0000-7000-8000-00000000e003';

const CORRETORA_A = '0191e5a0-0000-7000-8000-00000000e101';
const BANCO_B = '0191e5a0-0000-7000-8000-00000000e102';
const TESOURO = '0191e5a0-0000-7000-8000-00000000e103';

const RENDA_FIXA = '0191e5a0-0000-7000-8000-00000000e201';
const POS_FIXADA = '0191e5a0-0000-7000-8000-00000000e202';
const INFLACAO = '0191e5a0-0000-7000-8000-00000000e203';
const RENDA_VARIAVEL = '0191e5a0-0000-7000-8000-00000000e204';
const ACOES = '0191e5a0-0000-7000-8000-00000000e205';

const CDB = '0191e5a0-0000-7000-8000-00000000e301';
const CDB_2 = '0191e5a0-0000-7000-8000-00000000e302';
const ITUB4 = '0191e5a0-0000-7000-8000-00000000e303';
const CAIXA_A = '0191e5a0-0000-7000-8000-00000000e304';
const CAIXA_B = '0191e5a0-0000-7000-8000-00000000e305';

const OBJETIVO = '0191e5a0-0000-7000-8000-00000000e401';
const ENCERRADO = '0191e5a0-0000-7000-8000-00000000e402';

const BENCHMARK_PROPRIO = '0191e5a0-0000-7000-8000-00000000e501';
const CDI = '019b0000-0000-7000-8000-000000000001';

let sql: Sql;
let tx: TestTransaction;

/**
 * A tela de Configurações é uma consulta só, de propósito — o banco fica em
 * outra rede, e cada leitura a mais aparece na abertura da tela. Contar as
 * chamadas é a única forma de essa decisão não se desfazer no primeiro "só mais
 * um select" por cadastro.
 */
const counting = (
  connection: TestTransaction,
): { readonly connection: Connection; readonly calls: () => number } => {
  let calls = 0;

  const proxy = new Proxy(connection, {
    apply: (target, thisArg, args: unknown[]) => {
      calls += 1;
      return Reflect.apply(target as never, thisArg, args);
    },
  });

  return { connection: proxy as unknown as Connection, calls: () => calls };
};

const transaction = async (
  id: string,
  options: {
    readonly kind: 'buy' | 'sell' | 'deposit';
    readonly portfolio: string;
    readonly institution: string;
    readonly asset?: string;
    readonly gross: string;
  },
): Promise<void> => {
  await tx`
    INSERT INTO transaction (
      id, kind, trade_date, settlement_date, portfolio_id, asset_id, institution_id,
      quantity, unit_price, gross_amount, net_amount
    )
    VALUES (
      ${id}, ${options.kind}, '2026-09-01', '2026-09-01', ${options.portfolio},
      ${options.asset ?? null}, ${options.institution}, 1, ${options.gross},
      ${options.gross}, ${options.gross}
    )
  `;
};

const position = async (
  portfolio: string,
  asset: string,
  date: string,
  value: string,
): Promise<void> => {
  await tx`
    INSERT INTO position_daily (
      portfolio_id, asset_id, position_date, quantity, avg_price, cost_basis,
      market_value, price_source_kind
    )
    VALUES (${portfolio}, ${asset}, ${date}, ${value}, 1, ${value}, ${value}, 'manual')
  `;
};

beforeAll(async () => {
  sql = createTestConnection();
  await prepareTestDatabase(sql);
});

afterAll(async () => {
  await closeDatabase(sql);
});

beforeEach(async () => {
  tx = await beginTestTransaction(sql);

  await tx`
    INSERT INTO portfolio (id, name, sort_order, benchmark_id)
    VALUES (${LONGO}, 'Longo prazo', 1, ${CDI}), (${IMOVEL}, 'Entrada do imóvel', 2, NULL)
  `;
  await tx`
    INSERT INTO portfolio (id, name, sort_order, archived_at)
    VALUES (${ANTIGA}, 'Viagem 2024', 3, '2026-03-04T12:00:00Z')
  `;
  await tx`
    INSERT INTO institution (id, name, role, fgc_covered, brokerage_per_order)
    VALUES
      (${CORRETORA_A}, 'Corretora A', 'custodian', FALSE, '0.00'),
      (${BANCO_B}, 'Banco B', 'both', TRUE, '4.90'),
      (${TESOURO}, 'Tesouro Direto', 'issuer', FALSE, '0.00')
  `;
  await tx`
    INSERT INTO category (id, parent_id, name, color_token, sort_order)
    VALUES
      (${RENDA_FIXA}, NULL, 'Renda fixa', 'class.rf', 1),
      (${POS_FIXADA}, ${RENDA_FIXA}, 'Pós-fixada', 'class.rf_pos', 2),
      (${INFLACAO}, ${RENDA_FIXA}, 'Inflação', 'class.rf_ipca', 3),
      (${RENDA_VARIAVEL}, NULL, 'Renda variável', 'class.rv', 4),
      (${ACOES}, ${RENDA_VARIAVEL}, 'Ações', 'class.acoes', 5)
  `;
  await tx`
    INSERT INTO asset (id, ticker, name, origin, category_id, issuer_id, price_source)
    VALUES
      (${CDB}, 'CDB-BANCOB-1', 'CDB Banco B', 'manual', ${POS_FIXADA}, ${BANCO_B}, 'manual'),
      (${CDB_2}, 'CDB-BANCOB-2', 'CDB Banco B 2', 'manual', ${INFLACAO}, ${BANCO_B}, 'manual')
  `;
  await tx`
    INSERT INTO asset (id, ticker, name, origin, category_id, price_source)
    VALUES (${ITUB4}, 'ITUB4', 'Itaú', 'market', ${ACOES}, 'auto')
  `;
  await tx`
    INSERT INTO asset (id, ticker, name, origin, b3_type, issuer_id, price_source)
    VALUES
      (${CAIXA_A}, 'CAIXA-CORRETORAA', 'Caixa A', 'manual', 'cash', ${CORRETORA_A}, 'manual'),
      (${CAIXA_B}, 'CAIXA-BANCOB', 'Caixa B', 'manual', 'cash', ${BANCO_B}, 'manual')
  `;
});

afterEach(async () => {
  await rollbackTestTransaction(tx);
});

describe('o instantâneo da tela de configurações', () => {
  it('lê a tela inteira numa consulta só', async () => {
    const counter = counting(tx);

    unwrapSuccess(await createSettingsRepository(counter.connection).snapshot());

    expect(counter.calls()).toBe(1);
  });

  it('carteira arquivada sai da lista e aparece à parte, com a data', async () => {
    const snapshot = unwrapSuccess(await createSettingsRepository(tx).snapshot());

    expect(snapshot.portfolios.map((portfolio) => portfolio.name)).toEqual([
      'Longo prazo',
      'Entrada do imóvel',
    ]);
    expect(snapshot.archived_portfolios).toEqual([
      { id: ANTIGA, name: 'Viagem 2024', archived_on: '2026-03-04' },
    ]);
  });

  it('a carteira traz o benchmark, a estratégia, os objetivos e o que impede excluí-la', async () => {
    await tx`
      INSERT INTO strategy_target (portfolio_id, category_id, target_pct)
      VALUES (${LONGO}, ${POS_FIXADA}, 60), (${LONGO}, ${ACOES}, 40)
    `;
    await tx`
      INSERT INTO goal (id, portfolio_id, name, target_amount, target_date, return_assumption)
      VALUES (${OBJETIVO}, ${LONGO}, 'Independência financeira', '1500000.00', '2040-01-01', 'IPCA+6'),
             (${ENCERRADO}, ${LONGO}, 'Já encerrado', '1000.00', '2027-01-01', NULL)
    `;
    await tx`UPDATE goal SET closed_at = NOW() WHERE id = ${ENCERRADO}`;
    await transaction('0191e5a0-0000-7000-8000-00000000e601', {
      kind: 'buy',
      portfolio: LONGO,
      institution: BANCO_B,
      asset: CDB,
      gross: '1000.00',
    });
    await transaction('0191e5a0-0000-7000-8000-00000000e602', {
      kind: 'buy',
      portfolio: LONGO,
      institution: CORRETORA_A,
      asset: ITUB4,
      gross: '500.00',
    });
    await transaction('0191e5a0-0000-7000-8000-00000000e603', {
      kind: 'sell',
      portfolio: LONGO,
      institution: CORRETORA_A,
      asset: ITUB4,
      gross: '100.00',
    });

    const [longo, imovel] = unwrapSuccess(
      await createSettingsRepository(tx).snapshot(),
    ).portfolios;

    expect(longo).toEqual({
      id: LONGO,
      name: 'Longo prazo',
      benchmark_id: CDI,
      benchmark_name: 'CDI',
      strategy_categories: 2,
      goals: ['Independência financeira'],
      transactions: 3,
      assets: 2,
    });
    expect(imovel).toMatchObject({
      benchmark_id: null,
      benchmark_name: null,
      strategy_categories: 0,
      goals: [],
      transactions: 0,
      assets: 0,
    });
  });

  it('o grupo de categorias soma ativos e carteiras distintas das que estão dentro dele', async () => {
    await tx`
      INSERT INTO strategy_target (portfolio_id, category_id, target_pct)
      VALUES
        (${LONGO}, ${POS_FIXADA}, 30), (${LONGO}, ${INFLACAO}, 30), (${LONGO}, ${ACOES}, 40),
        (${IMOVEL}, ${POS_FIXADA}, 100)
    `;

    const categories = unwrapSuccess(
      await createSettingsRepository(tx).snapshot(),
    ).categories;
    const byName = new Map(categories.map((category) => [category.name, category]));

    // Duas categorias do grupo na mesma carteira são uma carteira só.
    expect(byName.get('Renda fixa')).toMatchObject({
      assets: 2,
      strategies: 2,
      children: 2,
    });
    expect(byName.get('Pós-fixada')).toMatchObject({
      assets: 1,
      strategies: 2,
      children: 0,
    });
    expect(byName.get('Renda variável')).toMatchObject({
      assets: 1,
      strategies: 1,
      children: 1,
    });
  });

  it('a estratégia de uma carteira arquivada não conta como uso da categoria', async () => {
    await tx`
      INSERT INTO strategy_target (portfolio_id, category_id, target_pct)
      VALUES (${ANTIGA}, ${ACOES}, 100)
    `;

    const acoes = unwrapSuccess(
      await createSettingsRepository(tx).snapshot(),
    ).categories.find((category) => category.id === ACOES);

    expect(acoes?.strategies).toBe(0);
  });

  it('a instituição traz as carteiras que a usam, o caixa e o que impede excluí-la', async () => {
    await transaction('0191e5a0-0000-7000-8000-00000000e611', {
      kind: 'deposit',
      portfolio: LONGO,
      institution: CORRETORA_A,
      gross: '9000.00',
    });
    await transaction('0191e5a0-0000-7000-8000-00000000e612', {
      kind: 'deposit',
      portfolio: IMOVEL,
      institution: CORRETORA_A,
      gross: '1000.00',
    });
    await position(LONGO, CAIXA_A, '2026-10-07', '5000.00');
    await position(LONGO, CAIXA_A, '2026-10-08', '7192.87');
    await position(IMOVEL, CAIXA_A, '2026-10-08', '100.00');
    // Carteira arquivada não soma no caixa: ela está fora do patrimônio.
    await position(ANTIGA, CAIXA_A, '2026-10-08', '999.00');

    const institutions = unwrapSuccess(
      await createSettingsRepository(tx).snapshot(),
    ).institutions;
    const corretora = institutions.find((institution) => institution.id === CORRETORA_A);

    expect(corretora).toMatchObject({
      name: 'Corretora A',
      portfolios: ['Entrada do imóvel', 'Longo prazo'],
      // O último valor de cada carteira, e não a soma da história.
      cash: '7292.87',
      transactions: 2,
      assets: 1,
    });
    expect(institutions.find((institution) => institution.id === TESOURO)).toMatchObject({
      cash: null,
      portfolios: [],
      transactions: 0,
    });
  });

  it('a exposição do emissor é o aplicado menos o resgatado, e deixa o caixa de fora', async () => {
    await transaction('0191e5a0-0000-7000-8000-00000000e621', {
      kind: 'buy',
      portfolio: LONGO,
      institution: BANCO_B,
      asset: CDB,
      gross: '60000.00',
    });
    await transaction('0191e5a0-0000-7000-8000-00000000e622', {
      kind: 'buy',
      portfolio: IMOVEL,
      institution: BANCO_B,
      asset: CDB_2,
      gross: '40000.00',
    });
    await transaction('0191e5a0-0000-7000-8000-00000000e623', {
      kind: 'sell',
      portfolio: LONGO,
      institution: BANCO_B,
      asset: CDB,
      gross: '6740.00',
    });
    // Depósito no caixa do banco não é título emitido por ele.
    await transaction('0191e5a0-0000-7000-8000-00000000e624', {
      kind: 'deposit',
      portfolio: LONGO,
      institution: BANCO_B,
      gross: '4120.08',
    });

    const banco = unwrapSuccess(
      await createSettingsRepository(tx).snapshot(),
    ).institutions.find((institution) => institution.id === BANCO_B);

    expect(banco).toMatchObject({
      issuer_exposure: '93260.00',
      issued_assets: 2,
      brokerage_per_order: '4.90',
      fgc_covered: true,
      role: 'both',
    });
  });

  it('o benchmark traz quantas carteiras abertas o usam, e as de referência vêm semeadas', async () => {
    await tx`
      INSERT INTO benchmark (id, name, kind, definition, rebalance)
      VALUES (
        ${BENCHMARK_PROPRIO}, 'IPCA + 6%', 'index_plus_rate',
        '{"index":"IPCA","rate":0.06}'::JSONB, 'never'
      )
    `;
    await tx`UPDATE portfolio SET benchmark_id = ${BENCHMARK_PROPRIO} WHERE id = ${IMOVEL}`;
    // A carteira arquivada com benchmark não conta como uso.
    await tx`UPDATE portfolio SET benchmark_id = ${CDI} WHERE id = ${ANTIGA}`;

    const benchmarks = unwrapSuccess(
      await createSettingsRepository(tx).snapshot(),
    ).benchmarks;
    const byName = new Map(benchmarks.map((benchmark) => [benchmark.name, benchmark]));

    expect(byName.get('CDI')).toMatchObject({ kind: 'index', used_by: 1 });
    expect(byName.get('IPCA + 6%')).toMatchObject({
      kind: 'index_plus_rate',
      rebalance: 'never',
      definition: { index: 'IPCA', rate: 0.06 },
      used_by: 1,
    });
    expect(byName.has('IFIX')).toBe(true);
  });

  it('as regras de alerta semeadas pelo mercado chegam, com o limite como veio', async () => {
    const alerts = unwrapSuccess(await createSettingsRepository(tx).snapshot()).alerts;

    expect(alerts.find((rule) => rule.kind === 'price_stale')).toEqual({
      kind: 'price_stale',
      enabled: true,
      scope: 'global',
      threshold: { days: 3 },
    });
  });
});

describe('o estado do backup', () => {
  const event = async (
    id: string,
    columns: {
      readonly completed?: string;
      readonly failed?: string;
      readonly error?: string;
    },
    key = id,
  ): Promise<void> => {
    await tx`
      INSERT INTO pipeline_outbox (
        id, stage, dedupe_key, payload, completed_at, failed_at, error, dispatched_at
      )
      VALUES (
        ${id}, 'backup', ${`backup:${key}`}, '{"reference_date":"2026-10-08"}'::JSONB,
        ${columns.completed ?? null}, ${columns.failed ?? null}, ${columns.error ?? null},
        ${columns.completed !== undefined || columns.failed !== undefined ? '2026-10-08T03:00:00Z' : null}
      )
    `;
  };

  it('sem nenhum backup, não há sucesso, falha nem pedido', async () => {
    const { backup } = unwrapSuccess(await createSettingsRepository(tx).snapshot());

    expect(backup).toEqual({
      last_success_at: null,
      last_failure_at: null,
      last_failure_error: null,
      pending: false,
    });
  });

  it('o último sucesso é o mais recente, e uma falha antiga já superada não aparece', async () => {
    await event('0191e5a0-0000-7000-8000-00000000e701', {
      failed: '2026-10-05T03:00:05Z',
      error: 'bucket recusou o upload',
    });
    await event('0191e5a0-0000-7000-8000-00000000e702', {
      completed: '2026-10-06T03:01:00Z',
    });
    await event('0191e5a0-0000-7000-8000-00000000e703', {
      completed: '2026-10-08T03:01:00Z',
    });

    const { backup } = unwrapSuccess(await createSettingsRepository(tx).snapshot());

    expect(new Date(backup.last_success_at ?? '').toISOString()).toBe(
      '2026-10-08T03:01:00.000Z',
    );
    expect(backup.last_failure_at).toBeNull();
    expect(backup.last_failure_error).toBeNull();
  });

  it('a falha que veio depois do último sucesso aparece, com a mensagem do erro', async () => {
    await event('0191e5a0-0000-7000-8000-00000000e711', {
      completed: '2026-10-07T03:01:00Z',
    });
    await event('0191e5a0-0000-7000-8000-00000000e712', {
      failed: '2026-10-08T03:00:09Z',
      error: 'age: chave pública inválida',
    });

    const { backup } = unwrapSuccess(await createSettingsRepository(tx).snapshot());

    expect(backup.last_failure_error).toBe('age: chave pública inválida');
    expect(new Date(backup.last_failure_at ?? '').toISOString()).toBe(
      '2026-10-08T03:00:09.000Z',
    );
  });

  it('um pedido que ainda não terminou é um backup pendente', async () => {
    await event('0191e5a0-0000-7000-8000-00000000e721', {});

    expect(
      unwrapSuccess(await createSettingsRepository(tx).snapshot()).backup.pending,
    ).toBe(true);
  });
});
