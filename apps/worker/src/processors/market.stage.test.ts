import { backfillAsset, collectMarketData } from '@patrimonio/application';
import type { Clock, UnitOfWork } from '@patrimonio/application';
import {
  closeDatabase,
  createConnection,
  createUnitOfWork,
  runMigrations,
} from '@patrimonio/db';
import type { Sql } from '@patrimonio/db';
import { environment } from '@patrimonio/env';
import { unwrapSuccess } from '@patrimonio/shared/testing';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  cdiSeries,
  scriptedIndices,
  scriptedQuotes,
  scriptedTreasury,
} from '../testing/market.js';
import type { Script } from '../testing/market.js';

/**
 * A coleta de ponta a ponta, contra Postgres real. O que é roteirizado é só o
 * provedor de mercado — que é a única coisa que a estratégia de testes manda
 * simular — e o relógio, que entra fixo para um ano de coletas rodar em
 * segundos.
 */
const PORTFOLIO = '0191e5a0-0000-7000-8000-00000000d001';
const INSTITUTION = '0191e5a0-0000-7000-8000-00000000d002';
const ACAO = '0191e5a0-0000-7000-8000-00000000d003';
const CDB = '0191e5a0-0000-7000-8000-00000000d004';
const TESOURO = '0191e5a0-0000-7000-8000-00000000d005';

const DATE = '2026-10-06';

let sql: Sql;
let unitOfWork: UnitOfWork;

const clock: Clock = {
  now: () => new Date('2026-10-06T21:30:00.000Z'),
  today: () => DATE,
};

const collect = (script: Script) =>
  collectMarketData({
    unitOfWork,
    clock,
    quotes: scriptedQuotes(script),
    indices: scriptedIndices(script),
    treasury: scriptedTreasury(script),
    staleAfterDays: 3,
  });

const backfill = (script: Script) =>
  backfillAsset({ unitOfWork, clock, quotes: scriptedQuotes(script) });

const outubro = [
  '2026-10-01',
  '2026-10-02',
  '2026-10-05',
  '2026-10-06',
] as const;

beforeAll(async () => {
  await runMigrations(environment.database.connection);

  sql = createConnection({
    connection: environment.database.connection,
    poolSize: 4,
    applicationName: 'patrimonio-market-stage-test',
  });

  unitOfWork = createUnitOfWork(sql);
});

afterAll(async () => {
  // Este teste comita, e o banco é compartilhado com a suíte de `db`, cujos
  // testes contam com as tabelas vazias.
  await limpar();
  await closeDatabase(sql);
});

const limpar = async (): Promise<void> => {
  await sql`delete from asset_price`;
  await sql`delete from index_quote`;
  await sql`delete from market_source_run`;
  await sql`delete from position_daily`;
  await sql`delete from portfolio_daily`;
  await sql`delete from pipeline_outbox`;
  await sql`delete from alert_instance`;
  await sql`delete from transaction`;
  await sql`delete from asset where id in (${ACAO}, ${CDB}, ${TESOURO})`;
  await sql`delete from portfolio where id = ${PORTFOLIO}`;
  await sql`delete from institution where id = ${INSTITUTION}`;
};

beforeEach(async () => {
  await limpar();

  await sql`
    insert into institution (id, name, role)
    values (${INSTITUTION}, 'Corretora Estágio', 'custodian')
  `;
  await sql`insert into portfolio (id, name) values (${PORTFOLIO}, 'Carteira Estágio')`;

  await sql`
    insert into asset (id, ticker, name, origin, b3_type, price_source)
    values (${ACAO}, 'STGA4', 'Ação do estágio', 'market', 'stock', 'auto')
  `;
  await sql`
    insert into asset (
      id, ticker, name, origin, b3_type, issuer_id, indexer, rate, issued_at,
      maturity_date, liquidity, tax_regime
    )
    values
      (${CDB}, 'STG-CDB-2028', 'CDB do estágio', 'manual', null, ${INSTITUTION},
       'cdi_pct', 112, '2026-10-01', '2028-10-10', 'at_maturity', 'regressive'),
      (${TESOURO}, 'STG-TESOURO-2029', 'Tesouro do estágio', 'market', 'treasury',
       null, 'ipca_plus', 0, '2026-10-01', '2029-05-15', 'daily', 'regressive')
  `;

  await sql`
    insert into transaction (
      id, kind, trade_date, settlement_date, portfolio_id, asset_id, institution_id,
      quantity, unit_price, fees, gross_amount, net_amount
    )
    values
      ('0191e5a0-0000-7000-8000-00000000e001', 'buy', '2026-10-01', '2026-10-05',
       ${PORTFOLIO}, ${ACAO}, ${INSTITUTION}, 100, 30, 0, 3000, -3000),
      ('0191e5a0-0000-7000-8000-00000000e002', 'buy', '2026-10-01', '2026-10-01',
       ${PORTFOLIO}, ${CDB}, ${INSTITUTION}, 1, 10000, 0, 10000, -10000),
      ('0191e5a0-0000-7000-8000-00000000e003', 'buy', '2026-10-01', '2026-10-02',
       ${PORTFOLIO}, ${TESOURO}, ${INSTITUTION}, 2, 2800, 0, 5600, -5600)
  `;
});

afterEach(async () => {
  await sql`delete from pipeline_outbox`;
});

const quote = (close: string, date = DATE) => ({
  ticker: 'STGA4',
  price_date: date,
  close,
});

const tesouroQuote = (date = DATE) => ({
  kind: 'ipca_plus' as const,
  maturity_date: '2029-05-15',
  quote_date: date,
  buy_price: '2985.42',
  sell_price: '2971.08',
  buy_rate: '7.42',
  sell_rate: '7.56',
});

describe('a coleta do dia', () => {
  it('grava preço, índice e Tesouro numa execução', async () => {
    const result = unwrapSuccess(
      await collect({
        quotes: [quote('32.41')],
        indices: cdiSeries([...outubro]),
        treasury: [tesouroQuote()],
      })({}),
    );

    expect(result.skipped).toBe(false);
    expect(result.prices_written).toBe(2);
    expect(result.indices_written).toBe(4);

    const prices = await sql<{ asset_id: string; close: string }[]>`
      select asset_id, close from asset_price order by asset_id
    `;
    expect(prices).toHaveLength(2);

    const [cdi] = await sql<{ daily_factor: string }[]>`
      select daily_factor from index_quote where quote_date = ${DATE}
    `;
    expect(cdi?.daily_factor).toBe('1.000419570000');
  });

  it('o fechamento do dia é encadeado, e só depois da coleta', async () => {
    unwrapSuccess(
      await collect({
        quotes: [quote('32.41')],
        indices: cdiSeries([...outubro]),
        treasury: [tesouroQuote()],
      })({}),
    );

    const [evento] = await sql<{ stage: string; dedupe_key: string }[]>`
      select stage, dedupe_key from pipeline_outbox where stage = 'close'
    `;

    expect(evento?.dedupe_key).toBe(`close:${DATE}`);
  });

  it('dia sem pregão não coleta nada: um feriado não tem preço', async () => {
    const natal = collectMarketData({
      unitOfWork,
      clock: { now: clock.now, today: () => '2026-12-25' },
      quotes: scriptedQuotes({ quotes: [quote('32.41', '2026-12-25')] }),
      indices: scriptedIndices({}),
      treasury: scriptedTreasury({}),
      staleAfterDays: 3,
    });

    const result = unwrapSuccess(await natal({}));

    expect(result.skipped).toBe(true);

    const [total] = await sql<{ total: string }[]>`
      select count(*)::text as total from asset_price
    `;
    expect(Number(total?.total)).toBe(0);
  });

  it('renda fixa de banco não é buscada: ela é marcada na curva', async () => {
    const result = unwrapSuccess(
      await collect({ quotes: [quote('32.41')], treasury: [tesouroQuote()] })({}),
    );

    const prices = await sql<{ asset_id: string }[]>`
      select asset_id from asset_price
    `;

    expect(prices.map((row) => row.asset_id)).not.toContain(CDB);
    expect(result.missing).not.toContain('STG-CDB-2028');
  });

  it('papel sem cotação fica marcado e nenhum zero é gravado', async () => {
    const result = unwrapSuccess(
      await collect({ quotes: [], treasury: [tesouroQuote()] })({}),
    );

    expect(result.missing).toContain('STGA4');

    const zeros = await sql<{ total: string }[]>`
      select count(*)::text as total from asset_price where close = 0
    `;
    expect(Number(zeros[0]?.total)).toBe(0);
  });

  it('o alerta de preço inexistente abre para o papel sem cotação', async () => {
    unwrapSuccess(await collect({ quotes: [] })({}));

    const alertas = await sql<{ rule_kind: string; subject_id: string }[]>`
      select rule_kind, subject_id from alert_instance
    `;

    expect(alertas.some((alerta) => alerta.rule_kind === 'price_missing')).toBe(true);
  });

  it('a execução de cada fonte fica registrada, com quem respondeu', async () => {
    unwrapSuccess(
      await collect({
        quotes: [quote('32.41')],
        indices: cdiSeries([...outubro]),
        treasury: [tesouroQuote()],
        source: 'brapi',
      })({}),
    );

    const runs = await sql<
      { source: string; kind: string; ok: boolean; source_kind: string | null }[]
    >`select source, kind, ok, source_kind from market_source_run order by kind`;

    expect(runs.map((row) => row.kind).sort()).toEqual([
      'indices',
      'quotes',
      'treasury',
    ]);
    expect(runs.every((row) => row.ok)).toBe(true);
    expect(runs.find((row) => row.kind === 'quotes')?.source_kind).toBe('primary');
  });

  it('a alternativa respondendo grava o preço como fallback', async () => {
    unwrapSuccess(
      await collect({
        quotes: [quote('31.90')],
        source: 'usebolsai',
        sourceKind: 'fallback',
      })({}),
    );

    const [row] = await sql<{ source: string; source_kind: string }[]>`
      select source, source_kind from asset_price where asset_id = ${ACAO}
    `;

    expect(row?.source).toBe('usebolsai');
    expect(row?.source_kind).toBe('fallback');
  });

  it('recoletar o mesmo dia produz exatamente as mesmas linhas', async () => {
    const script: Script = {
      quotes: [quote('32.41')],
      indices: cdiSeries([...outubro]),
      treasury: [tesouroQuote()],
    };

    unwrapSuccess(await collect(script)({}));
    const primeira = await sql<{ asset_id: string; close: string }[]>`
      select asset_id, close from asset_price order by asset_id
    `;

    unwrapSuccess(await collect(script)({}));
    const segunda = await sql<{ asset_id: string; close: string }[]>`
      select asset_id, close from asset_price order by asset_id
    `;

    expect(segunda).toEqual(primeira);
  });

  it('o Tesouro entra pelo preço de venda, que é quanto vale se vender hoje', async () => {
    unwrapSuccess(await collect({ treasury: [tesouroQuote()] })({}));

    const [row] = await sql<{ close: string }[]>`
      select close from asset_price where asset_id = ${TESOURO}
    `;

    expect(row?.close).toBe('2971.08000000');
  });
});

describe('o backfill de um papel', () => {
  it('preenche a série desde a primeira compra e pede o recálculo depois', async () => {
    const result = unwrapSuccess(
      await backfill({
        history: outubro.map((day, index) => quote(String(30 + index), day)),
      })({ asset_id: ACAO }),
    );

    expect(result.skipped).toBe(false);
    expect(result.prices_written).toBe(4);
    expect(result.recalculated).toEqual([PORTFOLIO]);

    const [evento] = await sql<{ payload: { from_date: string } }[]>`
      select payload from pipeline_outbox where stage = 'recalc'
    `;

    // O recálculo parte da data mais antiga preenchida: é ele que põe a série na
    // tela, e ele roda depois do backfill porque é o backfill que o pede.
    expect(evento?.payload.from_date).toBe('2026-10-01');
  });

  it('o que já tem preço não é buscado de novo', async () => {
    unwrapSuccess(
      await backfill({ history: [quote('30', '2026-10-01')] })({ asset_id: ACAO }),
    );

    const segunda = unwrapSuccess(
      await backfill({
        history: outubro.map((day, index) => quote(String(30 + index), day)),
      })({ asset_id: ACAO }),
    );

    expect(segunda.from).toBe('2026-10-02');
  });

  it('série completa não dispara busca nenhuma', async () => {
    unwrapSuccess(
      await backfill({
        history: outubro.map((day, index) => quote(String(30 + index), day)),
      })({ asset_id: ACAO }),
    );

    const segunda = unwrapSuccess(
      await backfill({ history: [] })({ asset_id: ACAO }),
    );

    expect(segunda.skipped).toBe(true);
  });

  it('renda fixa de banco não dispara backfill', async () => {
    const result = unwrapSuccess(await backfill({ history: [] })({ asset_id: CDB }));

    expect(result.skipped).toBe(true);
    expect(result.prices_written).toBe(0);
  });

  it('ativo que não existe falha nomeando-o, em vez de gravar nada', async () => {
    const result = await backfill({})({
      asset_id: '0191e5a0-0000-7000-8000-0000000000ff',
    });

    expect(result.isFailure()).toBe(true);
    if (!result.isFailure()) return;
    expect(result.value.statusCode).toBe(404);
  });

  it('o preço que chega depois dispara recálculo da data afetada para frente', async () => {
    // Um preço antigo chegando hoje: o recálculo pedido parte da data dele, não
    // de hoje, porque é dali para frente que a série muda.
    const result = unwrapSuccess(
      await backfill({ history: [quote('30', '2026-10-01')] })({ asset_id: ACAO }),
    );

    expect(result.from).toBe('2026-10-01');

    const [evento] = await sql<{ payload: { from_date: string } }[]>`
      select payload from pipeline_outbox where stage = 'recalc'
    `;

    expect(evento?.payload.from_date).toBe('2026-10-01');
  });

  it('o backfill fica registrado como execução de coleta', async () => {
    unwrapSuccess(
      await backfill({ history: [quote('30', '2026-10-01')] })({ asset_id: ACAO }),
    );

    const [row] = await sql<{ kind: string; items: number }[]>`
      select kind, items from market_source_run where kind = 'backfill'
    `;

    expect(row?.items).toBe(1);
  });
});

describe('uma semana de coleta', () => {
  it('quatro dias úteis seguidos produzem quatro dias de série, sem buraco e sem zero', async () => {
    // A compra é de 2026-10-01: antes dela não há posição para precificar, e a
    // coleta não gasta cota com papel que a carteira ainda não tem.
    const dias = ['2026-10-01', '2026-10-02', '2026-10-05', '2026-10-06'];

    for (const [index, dia] of dias.entries()) {
      const diario = collectMarketData({
        unitOfWork,
        clock: { now: () => new Date(`${dia}T21:30:00.000Z`), today: () => dia },
        quotes: scriptedQuotes({ quotes: [quote(String(30 + index), dia)] }),
        indices: scriptedIndices({ indices: cdiSeries([dia]) }),
        treasury: scriptedTreasury({ treasury: [tesouroQuote(dia)] }),
        staleAfterDays: 3,
      });

      unwrapSuccess(await diario({}));
    }

    const precos = await sql<{ price_date: string; close: string }[]>`
      select price_date, close
        from asset_price
       where asset_id = ${ACAO}
       order by price_date
    `;

    expect(precos.map((row) => row.price_date)).toEqual(dias);
    expect(precos.every((row) => Number(row.close) > 0)).toBe(true);

    const [fatores] = await sql<{ total: string }[]>`
      select count(*)::text as total from index_quote where index_code = 'CDI'
    `;
    expect(Number(fatores?.total)).toBe(4);

    // Um `close` por dia foi encadeado, e a coalescência não os perdeu: cada dia
    // tem a sua própria chave.
    const fechamentos = await sql<{ dedupe_key: string }[]>`
      select dedupe_key from pipeline_outbox where stage = 'close' order by dedupe_key
    `;
    expect(fechamentos.map((row) => row.dedupe_key)).toEqual(
      dias.map((dia) => `close:${dia}`),
    );
  });
});
