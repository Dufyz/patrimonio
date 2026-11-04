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
import { createAssetPageRepository } from './asset_page.repository.js';

/**
 * T-03 · A leitura da página do ativo.
 *
 * Contra Postgres real pela razão de sempre: é a consulta que erra. Um `join`
 * que duplica linha faz o provento do mês aparecer dobrado, e um `sum` sobre o
 * conjunto errado faz o peso na carteira descrever outra coisa — os dois
 * passam em qualquer mock.
 *
 * Os números são os da prancha 06, de propósito: 500 cotas de ITUB4 a 29,10 de
 * preço médio valendo 18.420,00, com 1.120,50 de provento em doze meses.
 */

const HOJE = '2026-10-06';
const ONTEM = '2026-10-05';
const ANO_PASSADO = '2025-10-06';

const CARTEIRA = '0191e5a0-0000-7000-8000-0000000c0001';
const OUTRA = '0191e5a0-0000-7000-8000-0000000c0002';
const CORRETORA = '0191e5a0-0000-7000-8000-0000000c0011';
const BANCO = '0191e5a0-0000-7000-8000-0000000c0012';
const ACOES = '0191e5a0-0000-7000-8000-0000000c0021';
const RF_PRE = '0191e5a0-0000-7000-8000-0000000c0022';
const ITUB4 = '0191e5a0-0000-7000-8000-0000000c0031';
const CDB = '0191e5a0-0000-7000-8000-0000000c0032';
const SPLIT = '0191e5a0-0000-7000-8000-0000000c0033';
const AUSENTE = '0191e5a0-0000-7000-8000-0000000c00ff';

let sql: Sql;
let tx: TestTransaction;

const filter = (
  overrides: Partial<
    Parameters<ReturnType<typeof createAssetPageRepository>['open']>[0]
  > = {},
) => ({
  today: HOJE,
  assetId: ITUB4 as string,
  portfolioId: CARTEIRA as string,
  period: '1a' as const,
  kind: null,
  ...overrides,
});

const open = async (
  overrides: Parameters<typeof filter>[0] = {},
): ReturnType<ReturnType<typeof createAssetPageRepository>['open']> =>
  createAssetPageRepository(tx).open(filter(overrides));

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
    INSERT INTO portfolio (id, name) VALUES
      (${CARTEIRA}, 'Longo prazo'),
      (${OUTRA}, 'Reserva')
  `;
  await tx`
    INSERT INTO institution (id, name) VALUES
      (${CORRETORA}, 'Corretora A'),
      (${BANCO}, 'Banco C')
  `;
  // A categoria de Ações tem regra automática por tipo de B3: é ela que faz a
  // página dizer "Ações · automática" sem um sinalizador por ativo.
  await tx`
    INSERT INTO category (id, name, color_token, auto_rule, sort_order) VALUES
      (${ACOES}, 'Ações', 'class.acoes', '{"b3_type":"stock"}'::JSONB, 1),
      (${RF_PRE}, 'RF prefixada', 'class.rf-pre', NULL, 2)
  `;
  await tx`
    INSERT INTO asset (id, ticker, name, origin, b3_type, sector, category_id) VALUES
      (${ITUB4}, 'ITUB4', 'Itaú Unibanco PN', 'market', 'stock', 'Bancos', ${ACOES}),
      (${SPLIT}, 'DESD3', 'Desdobrada ON', 'market', 'stock', 'Outros', ${ACOES})
  `;
  await tx`
    INSERT INTO asset
      (id, ticker, name, origin, category_id, issuer_id, indexer, rate,
       issued_at, maturity_date, liquidity, tax_regime)
    VALUES
      (${CDB}, 'CDBC2028', 'CDB Prefixado Banco C 2028', 'manual', ${RF_PRE},
       ${BANCO}, 'prefixed', '14.10', '2023-06-14', '2028-06-14',
       'at_maturity', 'regressive')
  `;

  // As três compras da prancha, e uma venda que dá resultado realizado.
  await tx`
    INSERT INTO transaction
      (id, kind, trade_date, settlement_date, portfolio_id, asset_id,
       institution_id, quantity, unit_price, net_amount)
    VALUES
      (GEN_RANDOM_UUID(), 'buy', '2025-03-12', '2025-03-14', ${CARTEIRA}, ${ITUB4},
       ${CORRETORA}, '100', '31.40', '3140.00'),
      (GEN_RANDOM_UUID(), 'buy', '2026-01-15', '2026-01-19', ${CARTEIRA}, ${ITUB4},
       ${CORRETORA}, '100', '33.80', '3380.00'),
      (GEN_RANDOM_UUID(), 'buy', '2026-06-10', '2026-06-12', ${CARTEIRA}, ${ITUB4},
       ${CORRETORA}, '50', '35.10', '1755.00'),
      (GEN_RANDOM_UUID(), 'sell', '2026-07-20', '2026-07-22', ${CARTEIRA}, ${ITUB4},
       ${CORRETORA}, '20', '36.00', '720.00'),
      (GEN_RANDOM_UUID(), 'buy', '2023-06-14', '2023-06-14', ${CARTEIRA}, ${CDB},
       ${BANCO}, '0', '0', '15120.00'),
      (GEN_RANDOM_UUID(), 'buy', '2026-02-02', '2026-02-04', ${OUTRA}, ${ITUB4},
       ${BANCO}, '100', '30.00', '3000.00')
  `;

  await tx`
    INSERT INTO realized_result
      (transaction_id, portfolio_id, asset_id, trade_date, proceeds,
       cost_consumed, result)
    SELECT t.id, t.portfolio_id, t.asset_id, t.trade_date, '720.00', '582.00', '138.00'
      FROM transaction t
     WHERE t.kind = 'sell'
  `;

  // Proventos: dois confirmados dentro dos doze meses, um fora, um a receber,
  // e uma amortização, que é devolução de capital e não rendimento.
  await tx`
    INSERT INTO transaction
      (id, kind, trade_date, settlement_date, portfolio_id, asset_id,
       institution_id, quantity, unit_price, payout_kind, net_amount, confirmed_at)
    VALUES
      (GEN_RANDOM_UUID(), 'payout', '2025-12-10', '2025-12-20', ${CARTEIRA}, ${ITUB4},
       ${CORRETORA}, '200', '2.50', 'jcp', '500.00', NOW()),
      (GEN_RANDOM_UUID(), 'payout', '2026-03-10', '2026-03-20', ${CARTEIRA}, ${ITUB4},
       ${CORRETORA}, '250', '2.0420', 'jcp', '510.50', NOW()),
      (GEN_RANDOM_UUID(), 'payout', '2024-04-10', '2024-04-20', ${CARTEIRA}, ${ITUB4},
       ${CORRETORA}, '100', '9.00', 'dividend', '900.00', NOW()),
      (GEN_RANDOM_UUID(), 'payout', '2026-09-20', '2026-10-01', ${CARTEIRA}, ${ITUB4},
       ${CORRETORA}, '250', '0.0360', 'dividend', '9.00', NOW()),
      (GEN_RANDOM_UUID(), 'payout', '2026-05-05', '2026-05-15', ${CARTEIRA}, ${ITUB4},
       ${CORRETORA}, '250', '0.4040', 'amortization', '101.00', NOW())
  `;
  await tx`
    INSERT INTO transaction
      (id, kind, trade_date, settlement_date, portfolio_id, asset_id,
       institution_id, quantity, unit_price, payout_kind, net_amount)
    VALUES
      (GEN_RANDOM_UUID(), 'payout', '2026-10-10', '2026-10-20', ${CARTEIRA}, ${ITUB4},
       ${CORRETORA}, '250', '0.384480', 'jcp', '96.12')
  `;

  await tx`
    INSERT INTO position_daily
      (portfolio_id, asset_id, position_date, quantity, avg_price, cost_basis,
       market_value, price_source_kind, accrued_interest)
    VALUES
      (${CARTEIRA}, ${ITUB4}, ${HOJE}, '500', '29.10', '14550.00', '18420.00',
       'fresh', '0'),
      (${CARTEIRA}, ${ITUB4}, ${ONTEM}, '500', '29.10', '14550.00', '18270.00',
       'fresh', '0'),
      (${CARTEIRA}, ${ITUB4}, ${ANO_PASSADO}, '500', '29.10', '14550.00', '15675.00',
       'fresh', '0'),
      (${CARTEIRA}, ${CDB}, ${HOJE}, '0', '0', '15120.00', '16500.00',
       'fresh', '1380.00'),
      (${OUTRA}, ${ITUB4}, ${HOJE}, '100', '30.00', '3000.00', '3684.00',
       'fresh', '0')
  `;

  // A série do gráfico: um ponto por mês ao longo de dois anos, para a janela
  // de 6M recortar menos pontos que a de 1A.
  await tx`
    INSERT INTO asset_price (asset_id, price_date, close, source, source_kind)
    SELECT ${ITUB4},
           d::DATE,
           30 + (EXTRACT(month FROM d)::NUMERIC / 10),
           'brapi',
           'primary'
      FROM GENERATE_SERIES('2024-10-07'::DATE, ${HOJE}::DATE, INTERVAL '1 month') d
  `;
  await tx`
    INSERT INTO asset_price (asset_id, price_date, close, source, source_kind) VALUES
      (${ITUB4}, ${ANO_PASSADO}, '31.35', 'brapi', 'primary'),
      (${ITUB4}, ${HOJE}, '36.84', 'brapi', 'primary')
    ON CONFLICT (asset_id, price_date) DO UPDATE SET close = EXCLUDED.close
  `;
});

describe('identidade e cadastro', () => {
  it('traz o que o bloco "Dados do ativo" mostra', async () => {
    const view = unwrapSuccess(await open());

    expect(view.asset?.ticker).toBe('ITUB4');
    expect(view.asset?.name).toBe('Itaú Unibanco PN');
    expect(view.asset?.sector).toBe('Bancos');
    expect(view.asset?.b3_type).toBe('stock');
    expect(view.asset?.origin).toBe('market');
    expect(view.asset?.price_source).toBe('auto');
    expect(view.asset?.category_name).toBe('Ações');
    expect(view.asset?.color_token).toBe('class.acoes');
  });

  it('"automática" é derivado da regra, e não um sinalizador por ativo', async () => {
    const automatica = unwrapSuccess(await open());
    expect(automatica.asset?.category_automatic).toBe(true);

    // A mesma ação movida para uma categoria sem regra passa a ser manual, sem
    // nenhuma escrita além da troca de categoria.
    await tx`UPDATE asset SET category_id = ${RF_PRE} WHERE id = ${ITUB4}`;
    const manual = unwrapSuccess(await open());

    expect(manual.asset?.category_automatic).toBe(false);
  });

  it('o ativo que não existe volta nulo, para a rota devolver 404', async () => {
    const view = unwrapSuccess(await open({ assetId: AUSENTE }));

    expect(view.asset).toBeNull();
  });

  it('a renda fixa traz indexador, taxa, vencimento, carência e regime', async () => {
    const view = unwrapSuccess(await open({ assetId: CDB }));

    expect(view.asset?.indexer).toBe('prefixed');
    expect(view.asset?.rate).toBe('14.10000000');
    expect(view.asset?.maturity_date).toBe('2028-06-14');
    expect(view.asset?.issued_at).toBe('2023-06-14');
    expect(view.asset?.liquidity).toBe('at_maturity');
    expect(view.asset?.tax_regime).toBe('regressive');
    expect(view.asset?.issuer_name).toBe('Banco C');
  });
});

describe('posição', () => {
  it('os números da prancha, somados no banco e não aqui', async () => {
    const view = unwrapSuccess(await open());

    expect(view.as_of).toBe(HOJE);
    expect(view.position?.unit).toBe('quantity');
    expect(view.position?.quantity).toBe('500.00000000');
    expect(view.position?.avg_price).toBe('29.10000000');
    expect(view.position?.cost_basis).toBe('14550.00');
    expect(view.position?.value).toBe('18420.00');
    expect(view.position?.open_result).toBe('3870.00');
    expect(view.position?.open_result_ratio).toBe('0.265979');
  });

  it('o peso é contra o patrimônio do recorte, não contra o próprio valor', async () => {
    const view = unwrapSuccess(await open());

    // 18.420,00 de ITUB4 sobre 34.920,00 de carteira (com o CDB de 16.500,00).
    expect(view.position?.weight).toBe('0.527491');
  });

  it('o preço do dia e a variação saem do valor unitário', async () => {
    const view = unwrapSuccess(await open());

    expect(view.price.value).toBe('36.84000000');
    // 18.420,00 ÷ 500 contra 18.270,00 ÷ 500 do dia anterior.
    expect(view.price.day_change_ratio).toBe('0.008210');
    expect(view.price.price_health).toBe('fresh');
    expect(view.price.price_date).toBe(HOJE);
  });

  it('o resultado realizado soma as vendas do ativo no recorte', async () => {
    const view = unwrapSuccess(await open());

    expect(view.position?.realized_result).toBe('138.00');
  });

  it('nunca vendido devolve ausência, e não resultado realizado de zero', async () => {
    await tx`DELETE FROM realized_result`;
    const view = unwrapSuccess(await open());

    expect(view.position?.realized_result).toBeNull();
  });

  it('título na curva não finge ter quantidade nem preço', async () => {
    const view = unwrapSuccess(await open({ assetId: CDB }));

    expect(view.position?.unit).toBe('curve');
    expect(view.position?.quantity).toBeNull();
    expect(view.position?.avg_price).toBeNull();
    expect(view.price.value).toBeNull();
    // O que a marcação na curva acumulou, que é o "valor na curva" da tela.
    expect(view.position?.accrued_interest).toBe('1380.00');
    expect(view.position?.value).toBe('16500.00');
  });

  it('a posição é a da carteira, sem somar a outra ponta do mesmo papel', async () => {
    const view = unwrapSuccess(await open());

    expect(view.position?.quantity).toBe('500.00000000');
    expect(view.portfolios.map((item) => item.portfolio_name)).toEqual(['Longo prazo']);
  });

  it('sem posição aberta o histórico fica e a posição volta nula', async () => {
    await tx`DELETE FROM position_daily WHERE asset_id = ${ITUB4}`;
    const view = unwrapSuccess(await open());

    expect(view.position).toBeNull();
    expect(view.transactions.length).toBeGreaterThan(0);
  });
});

describe('proventos', () => {
  it('a grade tem doze meses, inclusive os sem provento', async () => {
    const view = unwrapSuccess(await open());

    expect(view.payout_months).toHaveLength(12);
    expect(view.payout_months[0]?.month).toBe('2025-11');
    expect(view.payout_months[11]?.month).toBe('2026-10');
  });

  it('cada mês é dividido por tipo de provento', async () => {
    const view = unwrapSuccess(await open());
    const dezembro = view.payout_months.find((month) => month.month === '2025-12');
    const marco = view.payout_months.find((month) => month.month === '2026-03');

    expect(dezembro?.jcp).toBe('500.00');
    expect(dezembro?.dividend).toBe('0');
    expect(marco?.jcp).toBe('510.50');
  });

  it('o total de doze meses é o da prancha, e o de fora da janela não entra', async () => {
    const view = unwrapSuccess(await open());

    // 500,00 + 510,50 + 9,00 + 101,00 de amortização; os 900,00 de 2024 ficam fora.
    expect(view.payouts_total_12m).toBe('1120.50');
  });

  it('amortização entra no recebido e sai do yield sobre custo', async () => {
    const view = unwrapSuccess(await open());

    // (500,00 + 510,50 + 9,00) ÷ 14.550,00 — sem os 101,00 de amortização.
    expect(view.position?.yield_on_cost_12m).toBe('0.070069');
  });

  it('papel sem provento devolve ausência, e não rendimento de zero', async () => {
    await tx`DELETE FROM transaction WHERE kind = 'payout'`;
    const view = unwrapSuccess(await open());

    expect(view.position?.yield_on_cost_12m).toBeNull();
    expect(view.payouts_total_12m).toBe('0');
  });

  it('o provento a receber aparece separado do recebido', async () => {
    const view = unwrapSuccess(await open());

    expect(view.upcoming_payouts).toHaveLength(1);
    expect(view.upcoming_payouts[0]?.settlement_date).toBe('2026-10-20');
    expect(view.upcoming_payouts[0]?.payout_kind).toBe('jcp');
    expect(view.upcoming_payouts[0]?.net_amount).toBe('96.12');
  });
});

describe('série do gráfico', () => {
  it('a janela recorta a série, e 6M traz menos pontos que 1A', async () => {
    const umAno = unwrapSuccess(await open());
    const seisMeses = unwrapSuccess(await open({ period: '6m' }));
    const tudo = unwrapSuccess(await open({ period: 'tudo' }));

    expect(seisMeses.points.length).toBeLessThan(umAno.points.length);
    expect(tudo.points.length).toBeGreaterThanOrEqual(umAno.points.length);
    expect(umAno.window.from).toBe(ANO_PASSADO);
    expect(umAno.window.to).toBe(HOJE);
  });

  it('a variação da janela sai do primeiro e do último ponto dela', async () => {
    const view = unwrapSuccess(await open());

    // 36,84 contra 31,35 um ano antes.
    expect(view.window.return_ratio).toBe('0.175120');
  });

  it('"com proventos" soma o provento por cota do período ao preço final', async () => {
    const view = unwrapSuccess(await open());

    // (36,84 + 2,50 + 2,042 + 0,036) ÷ 31,35 − 1, sem a amortização. O provento
    // por cota é o líquido sobre a quantidade na data-com, não o bruto.
    expect(view.window.return_with_payouts_ratio).toBe('0.321148');
  });

  it('sem preço nenhum na janela, a variação é traço e não zero', async () => {
    await tx`DELETE FROM asset_price WHERE asset_id = ${ITUB4}`;
    const view = unwrapSuccess(await open());

    expect(view.points).toHaveLength(0);
    expect(view.window.return_ratio).toBeNull();
    expect(view.window.from).toBeNull();
  });

  it('a compra e a venda viram marca no gráfico, somadas por dia', async () => {
    const view = unwrapSuccess(await open({ period: 'tudo' }));
    const compras = view.marks.filter((mark) => mark.side === 'buy');

    expect(compras.map((mark) => mark.trade_date)).toEqual([
      '2025-03-12',
      '2026-01-15',
      '2026-06-10',
    ]);
    expect(compras[2]?.quantity).toBe('50.00000000');
    expect(compras[2]?.unit_price).toBe('35.10000000');
    expect(view.marks.filter((mark) => mark.side === 'sell')).toHaveLength(1);
  });

  it('duas compras no mesmo dia viram uma marca com o preço médio delas', async () => {
    await tx`
      INSERT INTO transaction
        (id, kind, trade_date, settlement_date, portfolio_id, asset_id,
         institution_id, quantity, unit_price, net_amount)
      VALUES
        (GEN_RANDOM_UUID(), 'buy', '2026-06-10', '2026-06-12', ${CARTEIRA}, ${ITUB4},
         ${CORRETORA}, '50', '35.90', '1795.00')
    `;
    const view = unwrapSuccess(await open({ period: 'tudo' }));
    const dia = view.marks.filter((mark) => mark.trade_date === '2026-06-10');

    expect(dia).toHaveLength(1);
    expect(dia[0]?.quantity).toBe('100.00000000');
    expect(dia[0]?.unit_price).toBe('35.50000000');
  });

  it('o desdobramento confirmado ajusta a série, e o anunciado não', async () => {
    await tx`
      INSERT INTO asset_price (asset_id, price_date, close, source, source_kind) VALUES
        (${SPLIT}, '2026-09-01', '80.00', 'brapi', 'primary'),
        (${SPLIT}, ${HOJE}, '41.00', 'brapi', 'primary')
    `;
    await tx`
      INSERT INTO corporate_event
        (id, asset_id, kind, record_date, ratio_from, ratio_to)
      VALUES
        (GEN_RANDOM_UUID(), ${SPLIT}, 'split', '2026-09-15', '1', '2')
    `;

    const anunciado = unwrapSuccess(await open({ assetId: SPLIT, period: 'tudo' }));
    expect(anunciado.window.adjusted).toBe(false);
    expect(anunciado.points[0]?.adjusted_close).toBe('80.00000000');
    // Sem o ajuste a série mostra uma queda de 49% que não aconteceu.
    expect(anunciado.window.return_ratio).toBe('-0.487500');

    await tx`UPDATE corporate_event SET confirmed_at = NOW() WHERE asset_id = ${SPLIT}`;
    const confirmado = unwrapSuccess(await open({ assetId: SPLIT, period: 'tudo' }));

    expect(confirmado.window.adjusted).toBe(true);
    expect(confirmado.points[0]?.close).toBe('80.00000000');
    expect(confirmado.points[0]?.adjusted_close).toBe('40.00000000');
    expect(confirmado.window.return_ratio).toBe('0.025000');
    expect(confirmado.corporate_events[0]?.confirmed_at).not.toBeNull();
  });
});

describe('lançamentos', () => {
  it('a lista é curta e vem da mais recente para a mais antiga', async () => {
    const view = unwrapSuccess(await open());

    expect(view.transactions.length).toBeLessThanOrEqual(6);
    expect(view.transactions[0]?.trade_date).toBe('2026-10-10');
    expect(view.transactions[0]?.portfolio_name).toBe('Longo prazo');
    expect(view.transactions[0]?.institution_name).toBe('Corretora A');
  });

  it('o filtro de tipo recorta a lista e a contagem', async () => {
    const todos = unwrapSuccess(await open());
    const compras = unwrapSuccess(await open({ kind: 'buy' }));

    expect(todos.transactions_total).toBe(10);
    expect(compras.transactions_total).toBe(3);
    expect(compras.transactions.every((item) => item.kind === 'buy')).toBe(true);
  });

  it('a contagem de cada opção é de antes do filtro, para ela não se apagar', async () => {
    const compras = unwrapSuccess(await open({ kind: 'buy' }));
    const porTipo = new Map(
      compras.transaction_facets.map((facet) => [facet.kind, facet.count]),
    );

    expect(porTipo.get('buy')).toBe(3);
    expect(porTipo.get('payout')).toBe(6);
    expect(porTipo.get('sell')).toBe(1);
  });

  it('o provento a receber chega com confirmação nula', async () => {
    const view = unwrapSuccess(await open());
    const aReceber = view.transactions.find((item) => item.trade_date === '2026-10-10');

    expect(aReceber?.confirmed_at).toBeNull();
    expect(aReceber?.payout_kind).toBe('jcp');
  });

  it('o escopo de uma carteira não vê o lançamento da outra', async () => {
    const uma = unwrapSuccess(await open());
    const outra = unwrapSuccess(await open({ portfolioId: OUTRA }));

    expect(outra.transactions_total).toBe(1);
    expect(uma.transactions_total).toBeGreaterThan(outra.transactions_total);
    expect(uma.custodians.map((item) => item.institution_name)).toEqual(['Corretora A']);
    expect(outra.custodians.map((item) => item.institution_name)).toEqual(['Banco C']);
  });
});
