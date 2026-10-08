import { unwrapSuccess } from '@patrimonio/shared/testing';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { closeDatabase } from '../postgresql.js';
import type { Sql } from '../postgresql.js';
import {
  beginTestTransaction,
  createTestConnection,
  prepareTestDatabase,
  repositoriesOn,
  rollbackTestTransaction,
} from '../testing/database.js';
import type { TestTransaction } from '../testing/database.js';

const PORTFOLIO = '0191e5a0-0000-7000-8000-00000000b001';
const INSTITUTION = '0191e5a0-0000-7000-8000-00000000b002';
const ITUB4 = '0191e5a0-0000-7000-8000-00000000b003';
const KNRI11 = '0191e5a0-0000-7000-8000-00000000b004';
const CDB = '0191e5a0-0000-7000-8000-00000000b005';
const TESOURO = '0191e5a0-0000-7000-8000-00000000b006';
const ARQUIVADO = '0191e5a0-0000-7000-8000-00000000b007';
const MANUAL = '0191e5a0-0000-7000-8000-00000000b008';

let sql: Sql;
let tx: TestTransaction;
let repositories: ReturnType<typeof repositoriesOn>;

const price = (assetId: string, date: string, close: string) => ({
  asset_id: assetId,
  price_date: date,
  close,
  source: 'brapi',
  source_kind: 'primary' as const,
});

const run = (overrides: Record<string, unknown> = {}) => ({
  source: 'brapi',
  kind: 'quotes' as const,
  reference_date: '2026-10-06',
  started_at: '2026-10-06T21:30:00.000Z',
  finished_at: '2026-10-06T21:30:12.000Z',
  ok: true,
  source_kind: 'primary' as const,
  requests: 30,
  items: 30,
  missing: 0,
  ...overrides,
});

beforeAll(async () => {
  sql = createTestConnection();
  await prepareTestDatabase(sql);
});

afterAll(async () => {
  await closeDatabase(sql);
});

beforeEach(async () => {
  tx = await beginTestTransaction(sql);
  repositories = repositoriesOn(tx);

  // A suíte compartilha o banco com os testes de rota, que **comitam**. Dentro
  // desta transação as tabelas que estas consultas leem ficam vazias, e o
  // ROLLBACK devolve tudo no fim.
  await tx`delete from asset_price`;
  await tx`delete from index_quote`;
  await tx`delete from manual_price`;
  await tx`delete from announced_payout`;
  await tx`delete from market_source_run`;
  await tx`delete from transaction`;

  await tx`
    insert into institution (id, name, role)
    values (${INSTITUTION}, 'Corretora Mercado', 'custodian')
  `;
  await tx`insert into portfolio (id, name) values (${PORTFOLIO}, 'Carteira Mercado')`;

  await tx`
    insert into asset (id, ticker, name, origin, b3_type, price_source)
    values
      (${ITUB4}, 'MKTA4', 'Ação de teste', 'market', 'stock', 'auto'),
      (${KNRI11}, 'MKTF11', 'FII de teste', 'market', 'fii', 'auto'),
      (${ARQUIVADO}, 'MKTOLD3', 'Arquivado', 'market', 'stock', 'auto'),
      (${MANUAL}, 'MKTMAN11', 'Preço manual', 'market', 'stock', 'manual')
  `;
  await tx`
    insert into asset (
      id, ticker, name, origin, b3_type, issuer_id, indexer, rate, issued_at,
      maturity_date, liquidity, tax_regime
    )
    values
      (${CDB}, 'MKT-CDB-20281010', 'CDB de teste', 'manual', null, ${INSTITUTION},
       'cdi_pct', 112, '2024-01-02', '2028-10-10', 'at_maturity', 'regressive'),
      (${TESOURO}, 'MKT-TESOURO-IPCA-2029', 'Tesouro de teste', 'market', 'treasury',
       null, 'ipca_plus', 0, '2024-01-02', '2029-05-15', 'daily', 'regressive')
  `;

  await tx`update asset set archived_at = now() where id = ${ARQUIVADO}`;

  // O livro: é dele que sai quem precisa de preço.
  await tx`
    insert into transaction (
      id, kind, trade_date, settlement_date, portfolio_id, asset_id, institution_id,
      quantity, unit_price, fees, gross_amount, net_amount
    )
    values
      ('0191e5a0-0000-7000-8000-00000000c001', 'buy', '2015-03-12', '2015-03-16',
       ${PORTFOLIO}, ${ITUB4}, ${INSTITUTION}, 100, 30, 0, 3000, -3000),
      ('0191e5a0-0000-7000-8000-00000000c002', 'buy', '2024-06-10', '2024-06-12',
       ${PORTFOLIO}, ${KNRI11}, ${INSTITUTION}, 50, 150, 0, 7500, -7500),
      ('0191e5a0-0000-7000-8000-00000000c003', 'buy', '2024-01-02', '2024-01-02',
       ${PORTFOLIO}, ${CDB}, ${INSTITUTION}, 1, 10000, 0, 10000, -10000),
      ('0191e5a0-0000-7000-8000-00000000c004', 'buy', '2024-01-02', '2024-01-03',
       ${PORTFOLIO}, ${TESOURO}, ${INSTITUTION}, 2, 2800, 0, 5600, -5600),
      ('0191e5a0-0000-7000-8000-00000000c005', 'buy', '2024-01-02', '2024-01-03',
       ${PORTFOLIO}, ${MANUAL}, ${INSTITUTION}, 10, 100, 0, 1000, -1000)
  `;
});

afterEach(async () => {
  await rollbackTestTransaction(tx);
});

describe('escrita dos preços', () => {
  it('trezentos preços são gravados numa consulta', async () => {
    // 150 dias úteis de dois papéis: 300 chaves distintas numa consulta, não
    // trezentas idas ao banco.
    const rows = Array.from({ length: 300 }, (_unused, index) => {
      const day = Math.floor(index / 2);

      return price(
        index % 2 === 0 ? ITUB4 : KNRI11,
        new Date(Date.UTC(2026, 0, 1) + day * 86_400_000).toISOString().slice(0, 10),
        '32.41',
      );
    });

    const written = unwrapSuccess(await repositories.market.upsertPrices(rows));

    expect(written).toBe(300);
  });

  it('a mesma chave duas vezes no lote não perde o lote inteiro', async () => {
    // O arquivo anual traz o papel em lote padrão e em fracionário no mesmo dia.
    // O `ON CONFLICT` do Postgres recusaria o lote inteiro; a última linha vence.
    const written = unwrapSuccess(
      await repositories.market.upsertPrices([
        price(ITUB4, '2026-10-06', '32.41'),
        price(ITUB4, '2026-10-06', '32.40'),
      ]),
    );

    expect(written).toBe(1);

    const [row] = await tx<{ close: string }[]>`
      select close from asset_price where asset_id = ${ITUB4}
    `;
    expect(row?.close).toBe('32.40000000');
  });

  it('recoletar o mesmo dia corrige o preço em vez de duplicar', async () => {
    unwrapSuccess(
      await repositories.market.upsertPrices([price(ITUB4, '2026-10-06', '32.41')]),
    );
    unwrapSuccess(
      await repositories.market.upsertPrices([
        {
          ...price(ITUB4, '2026-10-06', '32.68'),
          source: 'usebolsai',
          source_kind: 'fallback',
        },
      ]),
    );

    const rows = await tx<{ close: string; source: string; source_kind: string }[]>`
      select close, source, source_kind from asset_price where asset_id = ${ITUB4}
    `;

    expect(rows).toHaveLength(1);
    expect(rows[0]?.close).toBe('32.68000000');
    expect(rows[0]?.source_kind).toBe('fallback');
  });

  it('lista vazia não vai ao banco', async () => {
    expect(unwrapSuccess(await repositories.market.upsertPrices([]))).toBe(0);
    expect(unwrapSuccess(await repositories.market.upsertIndexQuotes([]))).toBe(0);
  });

  it('o preço manual continua vencendo a fonte automática na leitura', async () => {
    unwrapSuccess(
      await repositories.market.upsertPrices([price(ITUB4, '2026-10-06', '32.41')]),
    );
    unwrapSuccess(
      await repositories.manualPrices.upsert({
        asset_id: ITUB4,
        price_date: '2026-10-06',
        price: '30.00',
      }),
    );

    const [vigente] = unwrapSuccess(
      await repositories.prices.latestPricesOn([ITUB4], '2026-10-06'),
    );

    expect(vigente?.manual).toBe(true);
    expect(vigente?.close).toBe('30.00000000');
  });
});

describe('escrita dos índices', () => {
  it('o fator diário é gravado com o valor publicado ao lado', async () => {
    const written = unwrapSuccess(
      await repositories.market.upsertIndexQuotes([
        {
          index_code: 'CDI',
          quote_date: '2026-10-06',
          daily_factor: '1.000419570000',
          raw_value: '0.041957',
          source: 'bcb',
        },
      ]),
    );

    expect(written).toBe(1);

    const [quote] = unwrapSuccess(
      await repositories.prices.indexFactors(['CDI'], '2026-10-06', '2026-10-06'),
    );

    expect(quote?.daily_factor).toBe('1.000419570000');
    expect(quote?.raw_value).toBe('0.04195700');
  });

  it('recarregar o mesmo período não altera a contagem de linhas', async () => {
    const quotes = [
      {
        index_code: 'CDI' as const,
        quote_date: '2026-10-05',
        daily_factor: '1.000419570000',
        raw_value: '0.041957',
        source: 'bcb',
      },
      {
        index_code: 'CDI' as const,
        quote_date: '2026-10-06',
        daily_factor: '1.000419570000',
        raw_value: '0.041957',
        source: 'bcb',
      },
    ];

    unwrapSuccess(await repositories.market.upsertIndexQuotes(quotes));
    unwrapSuccess(await repositories.market.upsertIndexQuotes(quotes));

    const [total] = await tx<{ total: string }[]>`
      select count(*)::text as total from index_quote
    `;

    expect(Number(total?.total)).toBe(2);
  });
});

describe('quem precisa de preço', () => {
  it('sai do livro, com a data do lançamento mais antigo', async () => {
    const assets = unwrapSuccess(await repositories.market.priceableAssets('2026-10-06'));

    const itub4 = assets.find((asset) => asset.asset_id === ITUB4);
    expect(itub4?.first_trade_date).toBe('2015-03-12');
  });

  it('renda fixa de banco fica fora: é marcada na curva', async () => {
    const assets = unwrapSuccess(await repositories.market.priceableAssets('2026-10-06'));

    expect(assets.some((asset) => asset.asset_id === CDB)).toBe(false);
  });

  it('Tesouro entra, com indexador e vencimento para casar a cotação', async () => {
    const assets = unwrapSuccess(await repositories.market.priceableAssets('2026-10-06'));

    const tesouro = assets.find((asset) => asset.asset_id === TESOURO);
    expect(tesouro?.indexer).toBe('ipca_plus');
    expect(tesouro?.maturity_date).toBe('2029-05-15');
  });

  it('ativo arquivado e sem lançamento não gasta cota', async () => {
    const assets = unwrapSuccess(await repositories.market.priceableAssets('2026-10-06'));

    expect(assets.some((asset) => asset.asset_id === ARQUIVADO)).toBe(false);
  });

  it('ativo com preço manual não é buscado na fonte automática', async () => {
    const assets = unwrapSuccess(await repositories.market.priceableAssets('2026-10-06'));

    expect(assets.some((asset) => asset.asset_id === MANUAL)).toBe(false);
  });

  it('lançamento futuro não entra na coleta de hoje', async () => {
    const assets = unwrapSuccess(await repositories.market.priceableAssets('2015-03-12'));

    expect(assets.map((asset) => asset.asset_id)).toEqual([ITUB4]);
  });
});

describe('o que já tem preço', () => {
  it('as datas já gravadas são as que o backfill não busca de novo', async () => {
    unwrapSuccess(
      await repositories.market.upsertPrices([
        price(ITUB4, '2026-10-05', '32.00'),
        price(ITUB4, '2026-10-06', '32.41'),
      ]),
    );

    const dates = unwrapSuccess(
      await repositories.market.pricedDates(ITUB4, '2026-10-01', '2026-10-06'),
    );

    expect(dates).toEqual(['2026-10-05', '2026-10-06']);
  });

  it('o ativo específico traz a primeira data de negociação dele', async () => {
    const asset = unwrapSuccess(await repositories.market.priceableAsset(ITUB4));

    expect(asset?.first_trade_date).toBe('2015-03-12');
    expect(asset?.ticker).toBe('MKTA4');
  });

  it('ativo que não existe devolve nulo, não erro', async () => {
    const asset = unwrapSuccess(
      await repositories.market.priceableAsset('0191e5a0-0000-7000-8000-0000000000ff'),
    );

    expect(asset).toBeNull();
  });
});

describe('o registro das coletas', () => {
  it('a linha nasce com o que a tela de dados de mercado mostra', async () => {
    const recorded = unwrapSuccess(await repositories.market.recordRun(run()));

    expect(recorded.source).toBe('brapi');
    expect(recorded.ok).toBe(true);
    expect(recorded.requests).toBe(30);
    expect(recorded.source_kind).toBe('primary');
  });

  it('falha guarda a mensagem, que é o que a tela mostra em vez de um código', async () => {
    const recorded = unwrapSuccess(
      await repositories.market.recordRun(
        run({
          ok: false,
          error: 'brapi respondeu 503',
          source_kind: null,
          items: 0,
          detail: { field: 'results[0].regularMarketPrice', received: '"x"' },
        }),
      ),
    );

    expect(recorded.error).toBe('brapi respondeu 503');
    expect(recorded.detail).toEqual({
      field: 'results[0].regularMarketPrice',
      received: '"x"',
    });
  });

  it('a situação de cada fonte é a última execução dela', async () => {
    unwrapSuccess(
      await repositories.market.recordRun(
        run({
          started_at: '2026-10-05T21:30:00.000Z',
          finished_at: '2026-10-05T21:30:12.000Z',
          items: 10,
        }),
      ),
    );
    unwrapSuccess(
      await repositories.market.recordRun(
        run({ finished_at: '2026-10-06T21:30:12.000Z', items: 30 }),
      ),
    );
    unwrapSuccess(
      await repositories.market.recordRun(run({ source: 'bcb', kind: 'indices' })),
    );

    const statuses = unwrapSuccess(
      await repositories.market.sourceStatuses({
        requests_since: '2026-10-01T00:00:00.000Z',
      }),
    );

    const brapi = statuses.find((status) => status.source === 'brapi');
    expect(brapi?.last_run?.items).toBe(30);
    expect(statuses.map((status) => status.source).sort()).toEqual(['bcb', 'brapi']);
  });

  it('o consumo da janela soma as requisições da fonte', async () => {
    unwrapSuccess(
      await repositories.market.recordRun(
        run({ started_at: '2026-10-02T21:00:00.000Z', requests: 30 }),
      ),
    );
    unwrapSuccess(
      await repositories.market.recordRun(
        run({ started_at: '2026-10-03T21:00:00.000Z', requests: 30 }),
      ),
    );
    // Fora da janela: não entra na conta do mês.
    unwrapSuccess(
      await repositories.market.recordRun(
        run({ started_at: '2026-09-20T21:00:00.000Z', requests: 500 }),
      ),
    );

    const statuses = unwrapSuccess(
      await repositories.market.sourceStatuses({
        requests_since: '2026-10-01T00:00:00.000Z',
      }),
    );

    expect(statuses.find((status) => status.source === 'brapi')?.requests_in_window).toBe(
      60,
    );
  });

  it('as falhas recentes vêm da mais nova para a mais velha', async () => {
    unwrapSuccess(
      await repositories.market.recordRun(
        run({
          ok: false,
          error: 'primeira',
          started_at: '2026-10-04T21:30:00.000Z',
          finished_at: '2026-10-04T21:30:12.000Z',
        }),
      ),
    );
    unwrapSuccess(
      await repositories.market.recordRun(
        run({ ok: false, error: 'segunda', finished_at: '2026-10-06T21:30:12.000Z' }),
      ),
    );
    unwrapSuccess(await repositories.market.recordRun(run()));

    const failures = unwrapSuccess(await repositories.market.recentFailures(10));

    expect(failures.map((failure) => failure.error)).toEqual(['segunda', 'primeira']);
  });

  it('a última execução da bateria de contrato é consultável por tipo', async () => {
    unwrapSuccess(
      await repositories.market.recordRun(
        run({ kind: 'contract_check', reference_date: null, items: 4 }),
      ),
    );

    const last = unwrapSuccess(
      await repositories.market.lastRunOf('brapi', 'contract_check'),
    );

    expect(last?.items).toBe(4);
    expect(last?.reference_date).toBeNull();
  });

  it('falha sem mensagem é recusada pelo banco: a tela precisa do motivo', async () => {
    const result = await repositories.market.recordRun(run({ ok: false, error: null }));

    expect(result.isFailure()).toBe(true);
  });
});

describe('proventos anunciados', () => {
  const announced = (overrides: Record<string, unknown> = {}) => ({
    asset_id: ITUB4,
    payout_kind: 'dividend' as const,
    record_date: '2026-09-30',
    payment_date: '2026-10-20',
    amount_per_share: '0.22616',
    source: 'brapi',
    ...overrides,
  });

  it('reanunciar o mesmo provento atualiza em vez de duplicar', async () => {
    unwrapSuccess(await repositories.market.upsertAnnouncedPayouts([announced()]));
    unwrapSuccess(
      await repositories.market.upsertAnnouncedPayouts([
        announced({ amount_per_share: '0.25000' }),
      ]),
    );

    const pending = unwrapSuccess(await repositories.market.pendingAnnouncedPayouts());

    expect(pending).toHaveLength(1);
    expect(pending[0]?.amount_per_share).toBe('0.25000000');
  });

  it('o anunciado que já virou lançamento sai da fila de pendentes', async () => {
    unwrapSuccess(await repositories.market.upsertAnnouncedPayouts([announced()]));
    const [pending] = unwrapSuccess(await repositories.market.pendingAnnouncedPayouts());

    const marked = unwrapSuccess(
      await repositories.market.markPayoutMaterialized(
        pending?.id ?? '',
        '0191e5a0-0000-7000-8000-00000000c001',
      ),
    );

    expect(marked).toBe(true);
    expect(unwrapSuccess(await repositories.market.pendingAnnouncedPayouts())).toEqual(
      [],
    );
  });

  it('marcar duas vezes não sobrescreve o lançamento já gerado', async () => {
    unwrapSuccess(await repositories.market.upsertAnnouncedPayouts([announced()]));
    const [pending] = unwrapSuccess(await repositories.market.pendingAnnouncedPayouts());

    unwrapSuccess(
      await repositories.market.markPayoutMaterialized(
        pending?.id ?? '',
        '0191e5a0-0000-7000-8000-00000000c001',
      ),
    );

    const again = unwrapSuccess(
      await repositories.market.markPayoutMaterialized(
        pending?.id ?? '',
        '0191e5a0-0000-7000-8000-00000000c002',
      ),
    );

    expect(again).toBe(false);
  });
});
