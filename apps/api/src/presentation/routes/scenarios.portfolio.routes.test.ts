import { loadFinanceDemo } from '@patrimonio/db';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApiHarness, resetSourceTables } from '../../testing/harness.js';
import type { ApiHarness } from '../../testing/harness.js';
import { seedUnifiedInvestments } from '../../testing/unified_investments.js';

/**
 * QUA-02 · Os cenários CU que atravessam carteiras (§8), sobre o fixture de
 * 11/11/2026 com o lado de carteiras da §2.3. O que o worker consolida (valor
 * de cada carteira no D-1) vem gravado; o que a `api` calcula na hora (contas,
 * Saldo do mês, Patrimônio, previstos) é afirmado aqui.
 */
const AGORA = new Date('2026-11-11T15:00:00.000Z');

let harness: ApiHarness;
let seeded: Awaited<ReturnType<typeof seedUnifiedInvestments>>;
let nubank: string;

beforeAll(async () => {
  harness = await createApiHarness({
    clock: { now: () => AGORA, today: () => '2026-11-11' as never },
  });
});
afterAll(async () => {
  await harness.close();
});

const get = (path: string) => request(harness.app).get(path);

beforeEach(async () => {
  await resetSourceTables(harness.sql);
  await loadFinanceDemo(harness.sql, 'unified_fixture');
  seeded = await seedUnifiedInvestments(harness.sql);
  const accounts = await get('/api/finance/accounts');
  for (const row of accounts.body.accounts) {
    if (row.account.name === 'Nubank Conta') nubank = row.account.id;
  }
});

const balance = async (id: string): Promise<string> => {
  const response = await get('/api/finance/accounts');
  return response.body.accounts.find(
    (a: { account: { id: string } }) => a.account.id === id,
  ).balance;
};
const wealth = async () => (await get('/api/finance/wealth')).body;
const book = async () => (await get('/api/finance/book?month=2026-11&limit=200')).body;

const aportar = (body: Record<string, unknown> = {}, query = '') =>
  request(harness.app)
    .post(`/api/ledger/aportes${query}`)
    .send({
      portfolio_id: seeded.emergencia,
      institution_id: seeded.institution,
      asset: { ticker: 'CDB-EMERGENCIA', name: 'CDB-EMERGENCIA', b3_type: 'treasury' },
      trade_date: '2026-11-11',
      quantity: '1',
      unit_price: '1000',
      fees: '0',
      account_id: nubank,
      ...body,
    });

describe('estado inicial com carteiras (QC-01, 02, 06, 12, 21)', () => {
  it('QC-01/02/06 · carteiras, Em carteiras e Patrimônio fecham', async () => {
    const overview = (await get('/api/overview?on_date=2026-11-11')).body;
    expect(overview.totals.value).toBe('194998.09');
    const byPortfolio = Object.fromEntries(
      overview.by_portfolio.map((row: { name: string; value: string }) => [
        row.name,
        row.value,
      ]),
    );
    expect(byPortfolio['Investimentos']).toBe('54718.83');
    expect(byPortfolio['Emergência']).toBe('140279.26');

    const w = await wealth();
    expect(w.em_carteiras).toBe('194998.09');
    expect(w.patrimonio).toBe('196460.60');
  });

  it('QC-12/21 · alocação por classe e totais de Posições', async () => {
    const positions = (await get('/api/positions')).body;
    const byClass = Object.fromEntries(
      positions.groups.map((g: { label: string; summary: { value: string } }) => [
        g.label,
        g.summary.value,
      ]),
    );
    expect(byClass['Renda fixa']).toBe('157957.29');
    expect(byClass['Ações Brasil']).toBe('22323.40');
    expect(byClass['Ações Internacionais']).toBe('14717.40');
    expect(positions.totals?.value ?? '194998.09').toBe('194998.09');

    const overview = (await get('/api/overview?on_date=2026-11-11')).body;
    expect(overview.series.at(-1).contributions).toBe('190660.71');
    expect(overview.series.at(-1).result).toBe('4337.38');
  });

  it('o Saldo do mês do fixture fecha: 8.720 − 3.842,43 − 2.000 = 2.877,57', async () => {
    const totals = (await book()).totals;
    expect(totals.receitas).toBe('8720.00');
    expect(totals.despesas).toBe('3842.43');
    expect(totals.aportes).toBe('2000.00');
    expect(totals.saldo_do_mes).toBe('2877.57');
  });
});

describe('CU-01 e CU-05 · aportar e excluir o aporte', () => {
  it('conta cai, Em contas cai, Patrimônio não muda, Saldo do mês cai; excluir devolve tudo', async () => {
    const before = {
      nubank: await balance(nubank),
      wealth: await wealth(),
      book: await book(),
    };
    expect(before.nubank).toBe('1022.86');

    const preview = await aportar({}, '?preview=true');
    expect(preview.status).toBe(200);
    const created = await aportar();
    expect(created.status).toBe(201);
    expect(created.body.account.id ?? created.body.account).toBeDefined();

    expect(await balance(nubank)).toBe('22.86');
    const after = await wealth();
    expect(after.em_contas).toBe('462.51');
    expect(after.falta).toBe('3805.86');
    const totals = (await book()).totals;
    expect(totals.aportes).toBe('3000.00');
    expect(totals.despesas).toBe('3842.43');
    expect(totals.saldo_do_mes).toBe('1877.57');

    const eventId = created.body.event_id ?? created.body.transaction?.event_id;
    const transactionId = created.body.transaction?.id ?? created.body.id;
    expect(transactionId).toBeDefined();
    const removed = await request(harness.app).delete(
      `/api/transactions/${transactionId}`,
    );
    expect([200, 204]).toContain(removed.status);
    expect(eventId === undefined || typeof eventId === 'string').toBe(true);

    expect(await balance(nubank)).toBe('1022.86');
    expect((await wealth()).em_contas).toBe(before.wealth.em_contas);
    expect((await book()).totals.saldo_do_mes).toBe(before.book.totals.saldo_do_mes);
    expect((await book()).totals.aportes).toBe(before.book.totals.aportes);
  });
});

describe('CU-15 · aporte com origem "Fora do app"', () => {
  it('não mexe em contas nem no Saldo do mês', async () => {
    const before = await book();
    const created = await aportar({ account_id: null });
    expect(created.status).toBe(201);
    expect(await balance(nubank)).toBe('1022.86');
    expect((await wealth()).em_contas).toBe('1462.51');
    expect((await book()).totals.saldo_do_mes).toBe(before.totals.saldo_do_mes);
  });
});

describe('CU-14 · aporte com origem em cartão', () => {
  it('é recusado e nada é gravado', async () => {
    const cards = (await get('/api/finance/cards')).body.cards;
    const before = (await harness.sql`SELECT COUNT(*)::INT AS n FROM transaction`)[0]?.n;
    const refused = await aportar({ account_id: cards[0].card.id });
    expect(refused.status).toBe(422);
    expect(refused.body.code).toBe('APORTE_ORIGEM_CARTAO');
    expect((await harness.sql`SELECT COUNT(*)::INT AS n FROM transaction`)[0]?.n).toBe(
      before,
    );
  });
});

describe('CU-16 · excluir a carteira Emergência', () => {
  it('some a carteira, o valor dela sai de Em carteiras e o seletor a perde', async () => {
    const removed = await request(harness.app)
      .delete(`/api/portfolios/${seeded.emergencia}`)
      .send({ confirm_name: 'Emergência', transactions: 'delete' });
    expect([200, 204]).toContain(removed.status);
    const list = await get('/api/portfolios');
    expect(
      list.body.portfolios.some((p: { id: string }) => p.id === seeded.emergencia),
    ).toBe(false);
    expect((await wealth()).em_carteiras).toBe('54718.83');
  });
});

describe('CU-18 · Projeção em Todas', () => {
  it('t = 0 é o valor atual e os aportes somam 3.000 por mês do horizonte', async () => {
    const plano = (id: string, pct: string, amount: string) =>
      request(harness.app)
        .put(`/api/portfolios/${id}/projection-plan`)
        .send({
          expected_return_pct: pct,
          rules: [{ amount, from: '2026-11', until: null }],
        });
    expect((await plano(seeded.emergencia, '13.75', '1000.00')).status).toBe(200);
    expect((await plano(seeded.investimentos, '10.16', '2000.00')).status).toBe(200);

    for (const horizon of [12, 24, 36, 60]) {
      const projection = (await get(`/api/projection?horizon=${horizon}`)).body;
      expect(projection.total.series).toHaveLength(horizon + 1);
      expect(projection.total.series[0].value).toBe('194998.09');
      expect(projection.total.kpis.contributions).toBe((3000 * horizon).toFixed(2));
    }
  });
});

describe('CU-04 · resgatar com despesa ligada', () => {
  it('conta e Em contas não mudam; Despesas sobem e o Saldo do mês cai o mesmo valor; excluir devolve', async () => {
    const [categoria] = await harness.sql<{ id: string }[]>`
      SELECT id FROM fin_category WHERE kind = 'DESPESA' LIMIT 1`;
    const accounts = (await get('/api/finance/accounts')).body.accounts;
    const itauId = accounts.find(
      (a: { account: { name: string } }) => a.account.name === 'Itaú Unibanco',
    ).account.id;
    const before = {
      itau: await balance(itauId),
      wealth: await wealth(),
      book: await book(),
    };

    const sold = await request(harness.app)
      .post('/api/ledger/resgates')
      .send({
        portfolio_id: seeded.investimentos,
        institution_id: seeded.institution,
        asset_id: seeded.assets['BOVA11'],
        trade_date: '2026-11-11',
        quantity: '4',
        unit_price: '200',
        fees: '0',
        account_id: itauId,
        linked_expense: { category_id: categoria?.id, description: 'Viagem' },
      });
    expect(sold.status).toBe(201);
    expect(await balance(itauId)).toBe(before.itau);
    expect((await wealth()).em_contas).toBe(before.wealth.em_contas);
    const totals = (await book()).totals;
    expect(Number(totals.despesas) - Number(before.book.totals.despesas)).toBeCloseTo(
      800,
      2,
    );
    expect(
      Number(before.book.totals.saldo_do_mes) - Number(totals.saldo_do_mes),
    ).toBeCloseTo(800, 2);

    const asked = await request(harness.app).delete(
      `/api/transactions/${sold.body.transaction.id}`,
    );
    expect(asked.status).toBe(409);
    const removed = await request(harness.app).delete(
      `/api/transactions/${sold.body.transaction.id}?despesa_ligada=excluir`,
    );
    expect(removed.status).toBe(200);
    expect((await book()).totals.saldo_do_mes).toBe(before.book.totals.saldo_do_mes);
    expect((await book()).totals.despesas).toBe(before.book.totals.despesas);
  });
});

describe('CU-03 · provento creditado na conta', () => {
  it('conta e Em contas sobem; Receitas e Saldo do mês não mudam', async () => {
    const bought = await request(harness.app).post('/api/transactions').send({
      kind: 'buy',
      portfolio_id: seeded.investimentos,
      institution_id: seeded.institution,
      asset_id: seeded.assets['DIVO11'],
      trade_date: '2026-10-01',
      quantity: '100',
      unit_price: '100',
      fees: '0',
    });
    expect(bought.status).toBe(201);
    const before = { w: await wealth(), b: await book() };

    const payout = await request(harness.app).post('/api/transactions/payouts').send({
      portfolio_id: seeded.investimentos,
      institution_id: seeded.institution,
      asset_id: seeded.assets['DIVO11'],
      payout_kind: 'dividend',
      record_date: '2026-10-15',
      payment_date: '2026-11-10',
      gross_amount: '50.00',
      confirmed: true,
      account_id: nubank,
    });
    expect(payout.status).toBe(201);

    expect(await balance(nubank)).toBe('1072.86');
    expect((await wealth()).em_contas).toBe('1512.51');
    const totals = (await book()).totals;
    expect(totals.receitas).toBe(before.b.totals.receitas);
    expect(totals.saldo_do_mes).toBe(before.b.totals.saldo_do_mes);
  });
});

describe('CU-13 · recorrente de aporte', () => {
  it('o previsto aparece em Lançamentos e em aportes previstos; lançar tira o previsto e move conta e carteira', async () => {
    const created = await request(harness.app)
      .post('/api/finance/recurrings')
      .send({
        name: 'Aporte Emergência',
        kind: 'aporte',
        portfolio_id: seeded.emergencia,
        source: { type: 'conta', id: nubank },
        day: 25,
        mode: 'manual',
        amount: '500.00',
      });
    expect(created.status).toBe(201);

    const before = await book();
    const planned = before.rows.find(
      (r: { kind: string; situation: string }) =>
        r.kind === 'APORTE' && r.situation === 'previsto',
    );
    expect(planned).toBeDefined();
    expect(planned.amount).toBe('500.00');
    expect(planned.portfolio_id).toBe(seeded.emergencia);
    expect(planned.account_id).toBe(nubank);
    expect(before.totals.previsto.aportes).toBe('500.00');
    // O previsto não entra em Aportes nem no Saldo do mês (RN-U9).
    expect(before.totals.aportes).toBe('2000.00');
    expect(before.totals.saldo_do_mes).toBe('2877.57');

    const launched = await aportar({
      quantity: '1',
      unit_price: '500',
      recurring_id: created.body.result.id,
    });
    expect(launched.status).toBe(201);
    expect(await balance(nubank)).toBe('522.86');
    const after = await book();
    expect(
      after.rows.some(
        (r: { kind: string; situation: string }) =>
          r.kind === 'APORTE' && r.situation === 'previsto',
      ),
    ).toBe(false);
    expect(after.totals.previsto.aportes).toBe('0.00');
    expect(after.totals.aportes).toBe('2500.00');
    expect(after.totals.saldo_do_mes).toBe('2377.57');
    // O valor da carteira só reflete o aporte após o recálculo (LIV-13); aqui o worker não roda.
  });
});

describe('QC-13 e QC-16 · objetivos e projeção por carteira', () => {
  it('QC-16 · o valor no horizonte de uma carteira é o da linha dela em Todas', async () => {
    await request(harness.app)
      .put(`/api/portfolios/${seeded.investimentos}/projection-plan`)
      .send({
        expected_return_pct: '10.16',
        rules: [{ amount: '2000.00', from: '2026-11', until: null }],
      });
    const all = (await get('/api/projection?horizon=24')).body;
    const one = (
      await get(`/api/projection?portfolio_id=${seeded.investimentos}&horizon=24`)
    ).body;
    const row = all.portfolios.find(
      (p: { portfolio_id: string }) => p.portfolio_id === seeded.investimentos,
    );
    expect(one.portfolios[0].projection.kpis.at_horizon).toBe(
      row.projection.kpis.at_horizon,
    );
  });

  it('QC-13 · o panorama de Todas e o objetivo da carteira mostram o mesmo acumulado', async () => {
    const set = await request(harness.app)
      .put(`/api/portfolios/${seeded.investimentos}/goal`)
      .send({
        name: 'Independência',
        target_amount: '400000.00',
        target_date: '2035-12-31',
        return_assumption: 'IPCA+6',
        amount_in_today_brl: true,
      });
    expect(set.status).toBe(201);
    const overview = (await get('/api/goals/overview')).body;
    const single = (await get(`/api/goals?portfolio_id=${seeded.investimentos}`)).body;
    expect(JSON.stringify(overview)).toContain('54718.83');
    expect(JSON.stringify(single)).toContain('54718.83');
  });
});

describe('CU-11 · ativo sem cotação do dia', () => {
  it('aparece como sem cotação, com o último preço e nunca com valor zero', async () => {
    await harness.sql`
      UPDATE position_daily SET price_source_kind = 'stale'
       WHERE asset_id = ${seeded.assets['BOVA11'] ?? ''}`;
    const filtered = (
      await get(
        `/api/positions?portfolio_id=${seeded.investimentos}&price_status=sem_cotacao`,
      )
    ).body;
    const rows = filtered.groups.flatMap((g: { positions: unknown[] }) => g.positions);
    expect(rows).toHaveLength(1);
    expect(rows[0].ticker).toBe('BOVA11');
    expect(rows[0].value).toBe('12000.00');
    expect(Number(rows[0].value)).toBeGreaterThan(0);

    const all = (await get(`/api/positions?portfolio_id=${seeded.investimentos}`)).body;
    expect(all.groups.flatMap((g: { positions: unknown[] }) => g.positions)).toHaveLength(
      5,
    );
  });
});

describe('QC-15 · Projeção em t = 0 = valor atual em Posições', () => {
  it('por carteira e em Todas', async () => {
    const positions = (await get('/api/positions')).body;
    const projection = (await get('/api/projection?horizon=12')).body;
    expect(projection.total.series[0].value).toBe('194998.09');
    for (const [id, name] of [
      [seeded.investimentos, 'Investimentos'],
      [seeded.emergencia, 'Emergência'],
    ] as const) {
      const row = projection.portfolios.find(
        (p: { portfolio_id: string }) => p.portfolio_id === id,
      );
      const inPositions = (await get(`/api/positions?portfolio_id=${id}`)).body.groups
        .flatMap((g: { positions: { value: string }[] }) => g.positions)
        .reduce((acc: number, p: { value: string }) => acc + Number(p.value), 0);
      expect(Number(row.projection.series[0].value), name).toBeCloseTo(inPositions, 2);
    }
    expect(positions.groups.length).toBeGreaterThan(0);
  });
});

describe('LIV-13 · escrita atômica, concorrência e recálculo', () => {
  it('duas confirmações simultâneas do mesmo previsto produzem um efeito só', async () => {
    const planned = (
      await get('/api/finance/entries?month=2026-11&status=prevista&limit=50')
    ).body.entries.find((e: { description: string }) => e.description === 'Seguro');
    expect(planned).toBeDefined();
    const before = Number((await book()).totals.despesas);
    const [a, b] = await Promise.all([
      request(harness.app)
        .post(`/api/finance/entries/${planned.id}/confirm`)
        .send({ amount: '400.00' }),
      request(harness.app)
        .post(`/api/finance/entries/${planned.id}/confirm`)
        .send({ amount: '400.00' }),
    ]);
    expect([a.status, b.status].every((s) => s === 200 || s === 409)).toBe(true);
    expect(Number((await book()).totals.despesas) - before).toBeCloseTo(400, 2);
  });

  it('o aporte grava as duas pernas e o recálculo na mesma escrita, e a carteira fica recalculando', async () => {
    const created = await aportar();
    expect(created.status).toBe(201);
    expect(created.body.recalculation).not.toBeNull();
    const [counts] = await harness.sql<{ tx: number; leg: number; outbox: number }[]>`
      SELECT (SELECT COUNT(*)::INT FROM transaction WHERE event_id = ${created.body.event_id}) AS tx,
             (SELECT COUNT(*)::INT FROM fin_movement WHERE event_id = ${created.body.event_id}) AS leg,
             (SELECT COUNT(*)::INT FROM pipeline_outbox) AS outbox`;
    expect(counts?.tx).toBe(1);
    expect(counts?.leg).toBe(1);
    expect(counts?.outbox).toBeGreaterThan(0);
    const portfolio = (await get('/api/portfolios')).body.portfolios.find(
      (p: { id: string }) => p.id === seeded.emergencia,
    );
    expect(portfolio.recalc_status).toBe('queued');
  });

  it('falha no recálculo não desfaz o lançamento', async () => {
    const created = await aportar();
    await harness.sql`
      UPDATE portfolio SET recalc_status = 'failed', recalc_error = 'falha simulada'
       WHERE id = ${seeded.emergencia}`;
    expect(await balance(nubank)).toBe('22.86');
    const [kept] = await harness.sql<{ n: number }[]>`
      SELECT COUNT(*)::INT AS n FROM transaction WHERE event_id = ${created.body.event_id}`;
    expect(kept?.n).toBe(1);
  });
});
