import { unwrapSuccess } from '@patrimonio/shared/testing';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { closeDatabase } from '../postgresql.js';
import type { Sql } from '../postgresql.js';
import {
  beginTestTransaction,
  createTestConnection,
  prepareTestDatabase,
  rollbackTestTransaction,
} from '../testing/database.js';
import type { TestTransaction } from '../testing/database.js';
import { createPositionViewRepository } from './position_view.repository.js';

/**
 * T-02 · A leitura da tela de Posições.
 *
 * O teste é contra Postgres real porque é a consulta que erra: um `join` que
 * duplica linha ou um `sum` sobre o conjunto errado passa em qualquer mock e
 * aparece na tela como subtotal que não bate com o extrato.
 *
 * Os números são os da prancha 05, de propósito.
 */

const HOJE = '2026-10-06';
const ONTEM = '2026-10-05';
const ANO_PASSADO = '2025-10-06';

const CARTEIRA = '0191e5a0-0000-7000-8000-0000000b0001';
const OUTRA = '0191e5a0-0000-7000-8000-0000000b0002';
const CORRETORA = '0191e5a0-0000-7000-8000-0000000b0011';
const BANCO = '0191e5a0-0000-7000-8000-0000000b0012';
const ACOES = '0191e5a0-0000-7000-8000-0000000b0021';
const RF_PRE = '0191e5a0-0000-7000-8000-0000000b0022';
const ITUB4 = '0191e5a0-0000-7000-8000-0000000b0031';
const WEGE3 = '0191e5a0-0000-7000-8000-0000000b0032';
const CDB = '0191e5a0-0000-7000-8000-0000000b0033';
const VENDIDO = '0191e5a0-0000-7000-8000-0000000b0034';

let sql: Sql;
let tx: TestTransaction;

const filter = (
  overrides: Partial<
    Parameters<ReturnType<typeof createPositionViewRepository>['open']>[0]
  > = {},
) => ({
  today: HOJE,
  portfolioId: CARTEIRA as string | null,
  groupBy: 'category' as const,
  search: null as string | null,
  categoryId: null as string | null,
  ...overrides,
});

const open = async (
  overrides: Parameters<typeof filter>[0] = {},
): ReturnType<ReturnType<typeof createPositionViewRepository>['open']> =>
  createPositionViewRepository(tx).open(filter(overrides));

beforeAll(async () => {
  sql = createTestConnection();
  await prepareTestDatabase(sql);
});

afterAll(async () => {
  await closeDatabase(sql);
});

afterEach(async () => {
  await rollbackTestTransaction(tx);
});

beforeEach(async () => {
  tx = await beginTestTransaction(sql);

  await tx`
    insert into portfolio (id, name) values
      (${CARTEIRA}, 'Longo prazo'),
      (${OUTRA}, 'Reserva')
  `;
  await tx`
    insert into institution (id, name, role) values
      (${CORRETORA}, 'Corretora A', 'custodian'),
      (${BANCO}, 'Banco C', 'both')
  `;
  await tx`
    insert into category (id, name, color_token, sort_order) values
      (${ACOES}, 'Ações', 'class.acoes', 1),
      (${RF_PRE}, 'RF prefixada', 'class.rf-pre', 2)
  `;
  await tx`
    insert into asset (id, ticker, name, origin, b3_type, category_id) values
      (${ITUB4}, 'ITUB4', 'Itaú Unibanco PN', 'market', 'stock', ${ACOES}),
      (${WEGE3}, 'WEGE3', 'WEG ON', 'market', 'stock', ${ACOES}),
      (${VENDIDO}, 'MGLU3', 'Magazine Luiza ON', 'market', 'stock', ${ACOES})
  `;
  // Título de banco: sem cotação, marcado na curva, com emissor obrigatório.
  await tx`
    insert into asset
      (id, ticker, name, origin, category_id, issuer_id, indexer, rate,
       issued_at, maturity_date, liquidity, tax_regime)
    values
      (${CDB}, 'CDBC2028', 'CDB Prefixado Banco C 2028', 'manual', ${RF_PRE},
       ${BANCO}, 'prefixed', '14.10', '2023-06-14', '2028-06-14',
       'at_maturity', 'regressive')
  `;

  await tx`
    insert into transaction
      (id, kind, trade_date, settlement_date, portfolio_id, asset_id,
       institution_id, quantity, unit_price, net_amount)
    values
      (gen_random_uuid(), 'buy', '2024-02-01', '2024-02-05', ${CARTEIRA}, ${ITUB4},
       ${CORRETORA}, '500', '29.10', '14550.00'),
      (gen_random_uuid(), 'buy', '2024-02-01', '2024-02-05', ${CARTEIRA}, ${WEGE3},
       ${CORRETORA}, '500', '36.80', '18400.00'),
      (gen_random_uuid(), 'buy', '2023-06-14', '2023-06-14', ${CARTEIRA}, ${CDB},
       ${BANCO}, '0', '0', '15120.00')
  `;
  // Provento confirmado dentro da janela de doze meses, e um fora dela.
  await tx`
    insert into transaction
      (id, kind, trade_date, settlement_date, portfolio_id, asset_id,
       institution_id, payout_kind, net_amount, confirmed_at)
    values
      (gen_random_uuid(), 'payout', '2026-05-10', '2026-05-20', ${CARTEIRA}, ${ITUB4},
       ${CORRETORA}, 'dividend', '1123.62', now()),
      (gen_random_uuid(), 'payout', '2024-01-10', '2024-01-20', ${CARTEIRA}, ${ITUB4},
       ${CORRETORA}, 'dividend', '900.00', now())
  `;

  await tx`
    insert into position_daily
      (portfolio_id, asset_id, position_date, quantity, avg_price, cost_basis,
       market_value, price_source_kind)
    values
      (${CARTEIRA}, ${ITUB4}, ${HOJE}, '500', '29.10', '14550.00', '18420.00', 'fresh'),
      (${CARTEIRA}, ${ITUB4}, ${ONTEM}, '500', '29.10', '14550.00', '18345.00', 'fresh'),
      (${CARTEIRA}, ${ITUB4}, ${ANO_PASSADO}, '500', '29.10', '14550.00', '15170.00', 'fresh'),
      (${CARTEIRA}, ${WEGE3}, ${HOJE}, '500', '36.80', '18400.00', '15230.00', 'stale'),
      (${CARTEIRA}, ${CDB}, ${HOJE}, '0', '0', '15120.00', '16500.00', 'fresh'),
      (${CARTEIRA}, ${VENDIDO}, ${HOJE}, '0', '0', '0.00', '0.00', 'fresh'),
      (${OUTRA}, ${ITUB4}, ${HOJE}, '100', '29.10', '2910.00', '3684.00', 'fresh')
  `;
  await tx`
    insert into asset_price (asset_id, price_date, close, source, source_kind) values
      (${ITUB4}, ${HOJE}, '36.84', 'brapi', 'primary'),
      (${WEGE3}, '2026-10-03', '30.46', 'brapi', 'fallback')
  `;
  await tx`
    insert into portfolio_daily
      (portfolio_id, position_date, total_value, net_flow, income, payouts,
       quota_value, quota_count, cumulative_contributions)
    values
      (${CARTEIRA}, ${HOJE}, '50150.00', '0', '0', '0', '1.159200', '43262.25', '48070.00'),
      (${CARTEIRA}, ${ONTEM}, '50075.00', '0', '0', '0', '1.157000', '43280.00', '48070.00'),
      (${CARTEIRA}, ${ANO_PASSADO}, '43000.00', '0', '0', '0', '1.000000', '43000.00', '48070.00')
  `;
});

describe('posições abertas', () => {
  it('a posição zerada fica no histórico e sai da tela', async () => {
    const view = unwrapSuccess(await open());

    expect(view.rows.map((row) => row.ticker)).not.toContain('MGLU3');
    expect(view.rows).toHaveLength(3);
  });

  it('o escopo de uma carteira não vê a posição da outra', async () => {
    const uma = unwrapSuccess(await open());
    const todas = unwrapSuccess(await open({ portfolioId: null }));

    expect(uma.rows.filter((row) => row.ticker === 'ITUB4')).toHaveLength(1);
    expect(todas.rows.filter((row) => row.ticker === 'ITUB4')).toHaveLength(2);
  });

  it('o custodiante vem do lançamento, não da projeção', async () => {
    const view = unwrapSuccess(await open());
    const itub4 = view.rows.find((row) => row.ticker === 'ITUB4');
    const cdb = view.rows.find((row) => row.ticker === 'CDBC2028');

    expect(itub4?.institution_name).toBe('Corretora A');
    expect(cdb?.institution_name).toBe('Banco C');
  });

  it('título de banco vem marcado na curva, sem quantidade nem preço', async () => {
    const view = unwrapSuccess(await open());
    const cdb = view.rows.find((row) => row.ticker === 'CDBC2028');

    expect(cdb?.unit).toBe('curve');
    expect(cdb?.quantity).toBeNull();
    expect(cdb?.price).toBeNull();
    expect(cdb?.indexer).toBe('prefixed');
    expect(cdb?.maturity_date).toBe('2028-06-14');
  });

  it('o preço unitário sai do valor pela quantidade, com a escala do preço', async () => {
    const view = unwrapSuccess(await open());
    const itub4 = view.rows.find((row) => row.ticker === 'ITUB4');

    expect(itub4?.price).toBe('36.84000000');
    expect(itub4?.avg_price).toBe('29.10000000');
  });

  it('o resultado aberto é valor menos custo, com a razão sobre o custo', async () => {
    const view = unwrapSuccess(await open());
    const itub4 = view.rows.find((row) => row.ticker === 'ITUB4');

    expect(itub4?.open_result).toBe('3870.00');
    expect(Number(itub4?.open_result_ratio)).toBeCloseTo(0.265979, 6);
  });

  it('o estado do preço vem gravado por linha, não inferido', async () => {
    const view = unwrapSuccess(await open());

    expect(view.rows.find((row) => row.ticker === 'WEGE3')?.price_health).toBe('stale');
    expect(view.rows.find((row) => row.ticker === 'WEGE3')?.price_date).toBe(
      '2026-10-03',
    );
    // Três posições abertas na carteira: duas com preço do dia, uma atrasada.
    expect(view.header.stale).toBe(1);
    expect(view.header.fresh).toBe(2);
  });
});

describe('somas', () => {
  it('o subtotal de cada grupo confere com a soma das linhas dele', async () => {
    const view = unwrapSuccess(await open());

    const acoes = view.summaries.find((summary) => summary.group_key === ACOES);
    expect(acoes?.count).toBe(2);
    // 18.420,00 + 15.230,00
    expect(acoes?.value).toBe('33650.00');
  });

  it('o total geral é a soma dos grupos, e o peso soma um', async () => {
    const view = unwrapSuccess(await open());
    const total = view.summaries.find((summary) => summary.group_key === null);

    expect(total?.count).toBe(3);
    expect(total?.value).toBe('50150.00');
    expect(total?.weight).toBe('1.000000');

    const soma = view.summaries
      .filter((summary) => summary.group_key !== null)
      .reduce((amount, summary) => amount + Number(summary.value), 0);
    expect(soma).toBeCloseTo(Number(total?.value), 2);
  });

  it('o peso de cada linha é sobre o recorte inteiro', async () => {
    const view = unwrapSuccess(await open());
    const soma = view.rows.reduce((amount, row) => amount + Number(row.weight), 0);

    expect(soma).toBeCloseTo(1, 5);
  });

  it('carteira sem fechamento devolve total zero, e não nulo', async () => {
    const view = unwrapSuccess(await open({ portfolioId: OUTRA, today: '2020-01-01' }));
    const total = view.summaries.find((summary) => summary.group_key === null);

    expect(view.rows).toHaveLength(0);
    expect(total?.value).toBe('0');
    expect(total?.count).toBe(0);
    expect(view.header.as_of).toBeNull();
  });
});

describe('agrupamento', () => {
  it('por categoria, o grupo leva o nome e o token de cor da categoria', async () => {
    const view = unwrapSuccess(await open());
    const itub4 = view.rows.find((row) => row.ticker === 'ITUB4');

    expect(itub4?.group_key).toBe(ACOES);
    expect(itub4?.group_label).toBe('Ações');
    expect(itub4?.group_color_token).toBe('class.acoes');
  });

  it('por instituição, o grupo é a custódia e não tem cor de classe', async () => {
    const view = unwrapSuccess(await open({ groupBy: 'institution' }));
    const cdb = view.rows.find((row) => row.ticker === 'CDBC2028');

    expect(cdb?.group_key).toBe(BANCO);
    expect(cdb?.group_label).toBe('Banco C');
    expect(cdb?.group_color_token).toBeNull();
  });

  it('por carteira, cada carteira é um grupo', async () => {
    const view = unwrapSuccess(await open({ portfolioId: null, groupBy: 'portfolio' }));
    const chaves = new Set(view.rows.map((row) => row.group_key));

    expect(chaves).toEqual(new Set([CARTEIRA, OUTRA]));
  });

  it('sem grupo, tudo cai num grupo só e o subtotal é o total', async () => {
    const view = unwrapSuccess(await open({ groupBy: 'none' }));
    const grupo = view.summaries.find((summary) => summary.group_key !== null);
    const total = view.summaries.find((summary) => summary.group_key === null);

    expect(new Set(view.rows.map((row) => row.group_key))).toEqual(
      new Set(['sem-grupo']),
    );
    expect(grupo?.value).toBe(total?.value);
  });

  it('os grupos vêm na ordem do subtotal, do maior para o menor', async () => {
    const view = unwrapSuccess(await open());
    const ordem: string[] = [];
    for (const row of view.rows) {
      if (ordem.at(-1) !== row.group_key) ordem.push(row.group_key);
    }

    // Ações soma 33.650,00 e RF prefixada 16.500,00.
    expect(ordem).toEqual([ACOES, RF_PRE]);
  });
});

describe('filtros', () => {
  it('a busca casa com código e com nome, sem distinguir maiúscula', async () => {
    const porCodigo = unwrapSuccess(await open({ search: 'itub' }));
    const porNome = unwrapSuccess(await open({ search: 'unibanco' }));

    expect(porCodigo.rows.map((row) => row.ticker)).toEqual(['ITUB4']);
    expect(porNome.rows.map((row) => row.ticker)).toEqual(['ITUB4']);
  });

  it('a pastilha de categoria filtra a tabela e não a própria contagem', async () => {
    const view = unwrapSuccess(await open({ categoryId: ACOES }));

    expect(view.rows.map((row) => row.ticker).toSorted()).toEqual(['ITUB4', 'WEGE3']);
    // As pastilhas continuam contando o conjunto sem o filtro de categoria.
    expect(view.facets.map((facet) => facet.id).toSorted()).toEqual(
      [ACOES, RF_PRE].toSorted(),
    );
  });

  it('o peso é recalculado sobre o recorte filtrado, e volta a somar um', async () => {
    const view = unwrapSuccess(await open({ categoryId: ACOES }));
    const soma = view.rows.reduce((amount, row) => amount + Number(row.weight), 0);

    expect(soma).toBeCloseTo(1, 5);
  });

  it('a busca também estreita as pastilhas, porque elas contam o que sobrou', async () => {
    const view = unwrapSuccess(await open({ search: 'itub' }));

    expect(view.facets).toHaveLength(1);
    expect(view.facets[0]?.count).toBe(1);
  });
});

describe('cabeçalho', () => {
  it('a variação do dia de uma linha sai do valor unitário', async () => {
    const view = unwrapSuccess(await open());
    const itub4 = view.rows.find((row) => row.ticker === 'ITUB4');

    // 18.420 / 18.345 − 1
    expect(Number(itub4?.day_change_ratio)).toBeCloseTo(0.004088, 5);
    expect(Number(itub4?.return_12m_ratio)).toBeCloseTo(0.214238, 5);
  });

  it('linha sem histórico de doze meses devolve ausência, não zero', async () => {
    const view = unwrapSuccess(await open());

    expect(view.rows.find((row) => row.ticker === 'WEGE3')?.return_12m_ratio).toBeNull();
  });

  it('o retorno da carteira sai da série de cota, que o fluxo não contamina', async () => {
    const view = unwrapSuccess(await open());

    expect(Number(view.header.day_change_ratio)).toBeCloseTo(0.001901, 5);
    expect(Number(view.header.return_12m_ratio)).toBeCloseTo(0.1592, 4);
  });

  it('no escopo de todas as carteiras não há cota, e o retorno fica em branco', async () => {
    const view = unwrapSuccess(await open({ portfolioId: null }));

    expect(view.header.return_12m_ratio).toBeNull();
  });

  it('os proventos do cabeçalho cobrem doze meses, e só os confirmados', async () => {
    const view = unwrapSuccess(await open());

    expect(view.header.payouts_12m).toBe('1123.62');
  });

  it('o rendimento sobre o preço usa os proventos do próprio ativo', async () => {
    const view = unwrapSuccess(await open());
    const itub4 = view.rows.find((row) => row.ticker === 'ITUB4');

    // 1.123,62 / 18.420,00
    expect(Number(itub4?.dividend_yield_12m)).toBeCloseTo(0.061, 3);
  });

  it('papel sem provento devolve ausência, e não rendimento de zero', async () => {
    const view = unwrapSuccess(await open());

    expect(
      view.rows.find((row) => row.ticker === 'WEGE3')?.dividend_yield_12m,
    ).toBeNull();
  });
});
