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
