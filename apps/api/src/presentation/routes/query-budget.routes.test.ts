import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createApiHarness,
  resetSourceTables,
  seedInstitution,
} from '../../testing/harness.js';
import type { ApiHarness } from '../../testing/harness.js';
import { QUERY_BUDGETS, SCREEN_QUERY_CEILING } from '../../testing/query-budget.js';
import type { QueryCount } from '../../testing/query-counter.js';
import { ROUTE_DOCS } from '../docs/openapi.js';

/**
 * T-11 · Nenhuma tela faz muitas consultas.
 *
 * O Postgres está fora da VPS, então uma tela que faz cinco consultas paga cinco
 * idas e voltas, e o N+1 volta sem ninguém notar. Aqui cada rota de tela é
 * chamada contra Postgres de verdade, as consultas que o driver envia são
 * contadas, e o teste falha ao passar do limite declarado em `query-budget.ts`.
 *
 * O cenário é semeado pelas rotas de escrita e por um fechamento de três dias,
 * para que nenhuma rota saia cedo por falta de dado: a contagem precisa ser a do
 * caminho inteiro.
 */
const DATA_DE_REFERENCIA = '2026-10-09';
const RELATORIO = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../reports/query-budget.json',
);

type Linha = {
  readonly screen: string;
  readonly path: string;
  readonly max: number;
  readonly queries: number;
  readonly control: number;
};

let harness: ApiHarness;
let carteira: string;
let ativo: string;
const relatorio: Linha[] = [];

const urlDe = (path: string): string => {
  const base = `/api${path.replace(':asset_id', ativo)}`;
  const query: Record<string, string> = {
    '/overview': `on_date=${DATA_DE_REFERENCIA}`,
    '/performance': `on_date=${DATA_DE_REFERENCIA}`,
    '/allocation': `portfolio_id=${carteira}&on_date=${DATA_DE_REFERENCIA}`,
    '/goals': `on_date=${DATA_DE_REFERENCIA}`,
    '/search': 'q=WEGE3',
  };

  const extra = query[path];
  return extra === undefined ? base : `${base}?${extra}`;
};

const medir = async (path: string): Promise<{ status: number; count: QueryCount }> => {
  const { result, count } = await harness.queryCounter.measure(() =>
    request(harness.app).get(urlDe(path)),
  );

  return { status: result.status, count };
};

/** O driver aprende os tipos de array uma vez por conexão: o pool sobe antes de medir. */
const aquecerPool = async (): Promise<void> => {
  await Promise.all(Array.from({ length: 4 }, () => harness.sql`SELECT PG_SLEEP(0.05)`));
};

beforeAll(async () => {
  harness = await createApiHarness();
  await resetSourceTables(harness.sql);

  carteira = (
    await request(harness.app).post('/api/portfolios').send({ name: 'Longo prazo' })
  ).body.portfolio.id;
  const corretora = await seedInstitution(harness.sql, 'Corretora A');

  const compra = await request(harness.app)
    .post('/api/transactions')
    .send({
      kind: 'buy',
      portfolio_id: carteira,
      institution_id: corretora,
      asset: { ticker: 'WEGE3', name: 'WEGE3 teste', b3_type: 'stock' },
      trade_date: '2026-08-10',
      quantity: '100',
      unit_price: '40.00',
      fees: '0',
    });
  expect(compra.status, JSON.stringify(compra.body)).toBe(201);
  ativo = compra.body.transaction.asset_id;

  // A projeção é do motor; a leitura é o que está sob teste. Três fechamentos
  // bastam para Desempenho e Visão geral passarem da primeira consulta.
  for (const [dia, total] of [
    ['2026-10-07', '4000.00'],
    ['2026-10-08', '4010.00'],
    ['2026-10-09', '4025.00'],
  ] as const) {
    await harness.sql`
      INSERT INTO portfolio_daily (
        portfolio_id, position_date, total_value, net_flow, income, payouts,
        quota_value, quota_count, cumulative_contributions
      )
      VALUES (
        ${carteira}, ${dia}, ${total}, '0.00', '0.00', '0.00',
        '1.000000000000', '1000.000000000000', '4000.00'
      )
    `;
  }

  await aquecerPool();
});

afterAll(async () => {
  // O relatório sai mesmo quando um limite foi estourado: é quando mais importa.
  const tabela = [
    '',
    'Consultas por rota (T-11)',
    ...relatorio.map(
      (linha) =>
        `  ${linha.screen.padEnd(15)} GET ${linha.path.padEnd(24)} ` +
        `${String(linha.queries).padStart(2)} / ${linha.max}` +
        `   (+${linha.control} de controle de transação)`,
    ),
    '',
  ].join('\n');
  process.stdout.write(`${tabela}\n`);

  await mkdir(dirname(RELATORIO), { recursive: true });
  await writeFile(
    RELATORIO,
    `${JSON.stringify({ ceiling: SCREEN_QUERY_CEILING, routes: relatorio }, null, 2)}\n`,
  );

  await harness.close();
});

describe('o orçamento declarado', () => {
  it('nenhuma tela declara mais de duas consultas', () => {
    for (const budget of QUERY_BUDGETS) {
      expect(budget.max, `${budget.screen} (${budget.path})`).toBeLessThanOrEqual(
        SCREEN_QUERY_CEILING,
      );
      expect(budget.reaches).toBeLessThanOrEqual(budget.max);
    }
  });

  it('toda rota do orçamento existe no registro como GET, e uma só vez', () => {
    const registered = new Set(
      ROUTE_DOCS.filter((route) => route.method === 'get').map((route) => route.path),
    );
    const declared = QUERY_BUDGETS.map((budget) => budget.path);

    expect(new Set(declared).size).toBe(declared.length);
    for (const path of declared) expect(registered.has(path), path).toBe(true);
  });
});

describe('as consultas que cada tela faz', () => {
  for (const budget of QUERY_BUDGETS) {
    it(`${budget.screen}: GET ${budget.path} cabe em ${budget.max} ${
      budget.max === 1 ? 'consulta' : 'consultas'
    }`, async () => {
      const { status, count } = await medir(budget.path);

      relatorio.push({
        screen: budget.screen,
        path: budget.path,
        max: budget.max,
        queries: count.queries,
        control: count.control,
      });

      expect(status).toBe(200);
      // O driver só conta o que o código pediu: se nada foi contado, o contador
      // está desligado, e passar no orçamento não significaria nada.
      expect(count.queries, 'o contador não viu nenhuma consulta').toBeGreaterThan(0);
      expect(
        count.queries,
        `a rota deveria alcançar ${budget.reaches} consulta(s) no cenário semeado:\n` +
          count.statements.join('\n'),
      ).toBeGreaterThanOrEqual(budget.reaches);
      expect(
        count.queries,
        `${budget.screen} passou de ${budget.max}:\n${count.statements.join('\n')}`,
      ).toBeLessThanOrEqual(budget.max);
    });
  }
});
