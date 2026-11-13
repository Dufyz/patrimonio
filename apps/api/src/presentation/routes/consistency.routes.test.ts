import { loadFinanceDemo } from '@patrimonio/db';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApiHarness, resetSourceTables } from '../../testing/harness.js';
import type { ApiHarness } from '../../testing/harness.js';

/**
 * QUA-01 · A suíte de consistência entre telas (§7), nos pares que a `api` de
 * Finanças serve. Cada teste é um par `QC-nn` e diz as duas rotas que não podem
 * divergir; o valor é o da demonstração de 24/10/2026, e o que se afirma é a
 * igualdade, não o número (os números absolutos da §2.3 estão em
 * `unified_fixture.test.ts`, no `calc`).
 *
 * Os pares que dependem de carteiras (QC-01, 02, 12, 13, 15, 16, 21) moram na
 * suíte de Investimentos, que tem o fixture de posições.
 */

const AGORA = new Date('2026-10-24T15:00:00.000Z');
const HOJE = '2026-10-24';
const MES = { from: '2026-10-01', to: '2026-10-31' };

let harness: ApiHarness;

beforeAll(async () => {
  harness = await createApiHarness({
    clock: { now: () => AGORA, today: () => HOJE as never },
  });
  await resetSourceTables(harness.sql);
  await loadFinanceDemo(harness.sql);
});
afterAll(async () => {
  await harness.close();
});

const get = async (path: string) => {
  const response = await request(harness.app).get(`/api/finance${path}`);
  expect(response.status, `${path}: ${JSON.stringify(response.body)}`).toBe(200);
  return response.body;
};

/** Dinheiro em centavos inteiros: a suíte que cobra exatidão não faz conta em float. */
const cents = (value: string): bigint => {
  const negative = value.startsWith('-');
  const [whole = '0', fraction = ''] = value.replace('-', '').split('.');
  const total = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0').slice(0, 2));
  return negative ? -total : total;
};
const text = (amount: bigint): string => {
  const abs = amount < 0n ? -amount : amount;
  return `${amount < 0n ? '-' : ''}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
};
const sum = (values: readonly string[]): string =>
  text(values.reduce((total, value) => total + cents(value), 0n));
const max0 = (amount: bigint): bigint => (amount > 0n ? amount : 0n);

type AccountRow = {
  account: { id: string; in_wealth: boolean; archived: boolean };
  balance: string;
};
type CardRow = { debt: { abertas: string; fechadas_a_pagar: string } };

const inWealth = (rows: readonly AccountRow[]) =>
  rows.filter((row) => row.account.in_wealth && !row.account.archived);

describe('QC · contas, cartões e patrimônio', () => {
  it('QC-03 Em contas: Visão geral = Contas = soma dos Extratos das contas no patrimônio', async () => {
    const wealth = await get('/wealth');
    const overview = await get('/overview?month=2026-10');
    const { accounts } = (await get('/accounts')) as { accounts: AccountRow[] };

    const counted = inWealth(accounts);
    const statements = await Promise.all(
      counted.map(
        (row) =>
          get(
            `/accounts/${row.account.id}/statement?from=2026-10-01&to=${HOJE}`,
          ) as Promise<{
            closing: string;
          }>,
      ),
    );

    expect(overview.em_contas.amount).toBe(wealth.em_contas);
    expect(sum(counted.map((row) => row.balance))).toBe(wealth.em_contas);
    expect(sum(statements.map((statement) => statement.closing))).toBe(wealth.em_contas);
  });

  it('QC-04 Faturas abertas: Visão geral = Cartões = soma das abertas de cada cartão', async () => {
    const wealth = await get('/wealth');
    const overview = await get('/overview?month=2026-10');
    const { cards } = (await get('/cards')) as { cards: CardRow[] };

    expect(overview.faturas_abertas).toBe(wealth.abertas);
    expect(sum(cards.map((card) => card.debt.abertas))).toBe(wealth.abertas);
  });

  it('QC-05 Total devido = abertas + fechadas a pagar = soma de todas as faturas não pagas', async () => {
    const wealth = await get('/wealth');
    const { cards } = (await get('/cards')) as { cards: CardRow[] };

    expect(sum([wealth.abertas, wealth.fechadas_a_pagar])).toBe(wealth.total_devido);
    expect(
      sum(cards.flatMap((card) => [card.debt.abertas, card.debt.fechadas_a_pagar])),
    ).toBe(wealth.total_devido);
  });

  it('QC-07 Livre após faturas = máx(0; Em contas − total devido), e "falta" é o que sobra do outro lado', async () => {
    const wealth = await get('/wealth');
    const free = cents(wealth.em_contas) - cents(wealth.total_devido);

    expect(wealth.livre).toBe(text(max0(free)));
    expect(wealth.falta).toBe(text(max0(-free)));
  });

  it('QC-06 Patrimônio = Em contas + Em carteiras (sem carteiras, o patrimônio não é inventado)', async () => {
    const wealth = await get('/wealth');

    if (wealth.em_carteiras === null) {
      expect(wealth.patrimonio).toBeNull();
    } else {
      expect(wealth.patrimonio).toBe(sum([wealth.em_contas, wealth.em_carteiras]));
    }
  });
});

describe('QC · fluxo do mês', () => {
  it('QC-09 Saldo do mês = Receitas − Despesas − Aportes, igual na Visão geral, em Lançamentos e no Livro', async () => {
    const overview = await get('/overview?month=2026-10');
    const entries = await get(`/entries?from=${MES.from}&to=${MES.to}`);
    const book = await get(`/book?from=${MES.from}&to=${MES.to}`);

    const expected = text(
      cents(book.totals.receitas) -
        cents(book.totals.despesas) -
        cents(book.totals.aportes),
    );

    expect(book.totals.saldo_do_mes).toBe(expected);
    expect(entries.indicators.saldo).toBe(expected);
    expect(overview.saldo).toBe(expected);
    expect(overview.receitas.amount).toBe(book.totals.receitas);
    expect(overview.despesas.amount).toBe(book.totals.despesas);
  });

  it('QC-10 Despesas por categoria somam o total de Despesas = o filtrado em Lançamentos = o lançado de cada categoria em Categorias', async () => {
    const breakdown = await get(
      `/categories/breakdown?kind=despesa&from=${MES.from}&to=${MES.to}`,
    );
    const usage = await get(`/categories/usage?from=${MES.from}&to=${MES.to}`);
    const entries = await get(`/entries?from=${MES.from}&to=${MES.to}`);
    const book = await get(`/book?from=${MES.from}&to=${MES.to}`);

    expect(sum(breakdown.rows.map((row: { amount: string }) => row.amount))).toBe(
      breakdown.total,
    );
    expect(breakdown.total).toBe(book.totals.despesas);
    expect(entries.indicators.despesas.amount).toBe(book.totals.despesas);

    // Categorias: o "lançado" de cada categoria de despesa é o da Visão geral.
    const posted = new Map<string, string>(
      usage.rows.map((row: { category_id: string; posted: string }) => [
        row.category_id,
        row.posted,
      ]),
    );
    for (const row of breakdown.rows as { category_id: string; amount: string }[]) {
      expect(posted.get(row.category_id), row.category_id).toBe(row.amount);
    }
  });

  it('QC-17 Os percentuais de Despesas por categoria, em décimos, somam 100,0%', async () => {
    const breakdown = await get(
      `/categories/breakdown?kind=despesa&from=${MES.from}&to=${MES.to}`,
    );
    const tenths = (breakdown.rows as { tenths: number }[]).reduce(
      (total, row) => total + row.tenths,
      0,
    );

    expect(breakdown.rows.length).toBeGreaterThan(0);
    expect(tenths).toBe(1000);
  });

  it('QC-14 Próximos lançamentos: o "A lançar" da Visão geral = os previstos de Lançamentos = os do Livro', async () => {
    const overview = await get('/overview?month=2026-10');
    const entries = await get(`/entries?from=${MES.from}&to=${MES.to}`);
    const book = await get(`/book?from=${MES.from}&to=${MES.to}`);

    expect(overview.a_lancar.count).toBe(book.totals.a_lancar);
    expect(entries.indicators.a_lancar.count).toBe(book.totals.a_lancar);
    expect(overview.a_lancar.amount).toBe(entries.indicators.a_lancar.amount);
  });

  it('QC-08 Saldo previsto: a conta que a Visão geral mostra é a da série e a das partes', async () => {
    const forecast = await get(`/forecast?date=${MES.to}`);
    const last = forecast.series.points.at(-1);

    expect(last.date).toBe(MES.to);
    expect(last.balance).toBe(forecast.balance);
    // saldo = em contas + entradas − saídas − aportes − faturas
    const parts = forecast.parts;
    expect(
      text(
        cents(parts.em_contas) +
          cents(parts.entradas) -
          cents(parts.saidas) -
          cents(parts.aportes) -
          cents(parts.faturas),
      ),
    ).toBe(parts.saldo);
    expect(parts.saldo).toBe(forecast.balance);
  });
});
