import type { Sql } from '@patrimonio/db';

/**
 * §2.3 · O lado de carteiras do fixture de 11/11/2026, gravado direto nas
 * tabelas de projeção (o que o worker produz ao consolidar o D-1 = 10/11).
 *
 * Investimentos 54.718,83 e Emergência 140.279,26; renda fixa 157.957,29,
 * Ações Brasil 22.323,40 (BOVA11, DIVO11) e Ações Internacionais 14.717,40
 * (IVVB11, WRLD11); investido 190.660,71; resultado +4.337,38.
 */
export const REFERENCE_DATE = '2026-11-10';

type Seeded = {
  readonly institution: string;
  readonly investimentos: string;
  readonly emergencia: string;
  readonly assets: Readonly<Record<string, string>>;
};

type Line = {
  readonly portfolio: 'investimentos' | 'emergencia';
  readonly ticker: string;
  readonly value: string;
  readonly cost: string;
  readonly quantity: string;
};

const LINES: readonly Line[] = [
  {
    portfolio: 'investimentos',
    ticker: 'BOVA11',
    value: '12000.00',
    cost: '11500.00',
    quantity: '100',
  },
  {
    portfolio: 'investimentos',
    ticker: 'DIVO11',
    value: '10323.40',
    cost: '10000.00',
    quantity: '300',
  },
  {
    portfolio: 'investimentos',
    ticker: 'IVVB11',
    value: '8000.00',
    cost: '7800.00',
    quantity: '25',
  },
  {
    portfolio: 'investimentos',
    ticker: 'WRLD11',
    value: '6717.40',
    cost: '6500.00',
    quantity: '60',
  },
  {
    portfolio: 'investimentos',
    ticker: 'TESOURO-SELIC',
    value: '17678.03',
    cost: '17000.00',
    quantity: '5',
  },
  {
    portfolio: 'emergencia',
    ticker: 'CDB-EMERGENCIA',
    value: '140279.26',
    cost: '137860.71',
    quantity: '1',
  },
];

const CLASS: Readonly<Record<string, string>> = {
  BOVA11: 'Ações Brasil',
  DIVO11: 'Ações Brasil',
  IVVB11: 'Ações Internacionais',
  WRLD11: 'Ações Internacionais',
  'TESOURO-SELIC': 'Renda fixa',
  'CDB-EMERGENCIA': 'Renda fixa',
};

const TOKEN: Readonly<Record<string, string>> = {
  'Ações Brasil': 'class.stock',
  'Ações Internacionais': 'class.international',
  'Renda fixa': 'class.fixed',
};

export const seedUnifiedInvestments = async (sql: Sql): Promise<Seeded> => {
  const [institution] = await sql<{ id: string }[]>`
    INSERT INTO institution (id, name) VALUES (GEN_RANDOM_UUID(), 'Corretora Fixture') RETURNING id`;
  const portfolios: Record<string, string> = {};
  for (const [key, name] of [
    ['investimentos', 'Investimentos'],
    ['emergencia', 'Emergência'],
  ] as const) {
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO portfolio (id, name) VALUES (GEN_RANDOM_UUID(), ${name}) RETURNING id`;
    portfolios[key] = row?.id ?? '';
  }

  const categories: Record<string, string> = {};
  for (const [name, token] of Object.entries(TOKEN)) {
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO category (id, name, color_token) VALUES (GEN_RANDOM_UUID(), ${name}, ${token}) RETURNING id`;
    categories[name] = row?.id ?? '';
  }

  const assets: Record<string, string> = {};
  const totals: Record<string, { value: number; cost: number }> = {};
  for (const line of LINES) {
    const [asset] = await sql<{ id: string }[]>`
      INSERT INTO asset (id, ticker, name, origin, b3_type, category_id)
      VALUES (GEN_RANDOM_UUID(), ${line.ticker}, ${line.ticker}, 'market',
              ${line.ticker.includes('TESOURO') ? 'treasury' : line.ticker.startsWith('CDB') ? 'treasury' : 'etf'},
              ${categories[CLASS[line.ticker] ?? 'Renda fixa'] ?? null})
      RETURNING id`;
    const assetId = asset?.id ?? '';
    assets[line.ticker] = assetId;
    const portfolioId = portfolios[line.portfolio] ?? '';
    await sql`
      INSERT INTO position_daily (
        portfolio_id, asset_id, position_date, quantity, avg_price, cost_basis,
        market_value, price_source_kind, accrued_interest)
      VALUES (${portfolioId}, ${assetId}, ${REFERENCE_DATE}, ${line.quantity}, '1.00000000',
              ${line.cost}, ${line.value}, 'fresh', '0.00')`;
    const total = totals[line.portfolio] ?? { value: 0, cost: 0 };
    total.value += Number(line.value);
    total.cost += Number(line.cost);
    totals[line.portfolio] = total;
  }

  for (const [key, id] of Object.entries(portfolios)) {
    const total = totals[key] ?? { value: 0, cost: 0 };
    await sql`
      INSERT INTO portfolio_daily (
        portfolio_id, position_date, total_value, net_flow, income, payouts,
        quota_value, quota_count, cumulative_contributions)
      VALUES (${id}, ${REFERENCE_DATE}, ${total.value.toFixed(2)}, '0.00', '0.00', '0.00',
              '1.000000000000', ${total.value.toFixed(12)}, ${total.cost.toFixed(2)})`;
  }

  // A perna de posição do aporte de 09/11 (R$ 2.000,00): a perna de conta já vem
  // do fixture de Finanças, ligada pelo mesmo `event_id`.
  const [leg] = await sql<{ event_id: string; id: string }[]>`
    SELECT event_id, id FROM fin_movement WHERE kind = 'APORTE' LIMIT 1`;
  if (leg !== undefined) {
    await sql`
      INSERT INTO transaction (
        id, kind, trade_date, settlement_date, portfolio_id, asset_id, institution_id,
        quantity, unit_price, fees, gross_amount, net_amount, event_id)
      VALUES (GEN_RANDOM_UUID(), 'buy', '2026-11-09', '2026-11-09',
              ${portfolios['investimentos'] ?? ''}, ${assets['BOVA11'] ?? ''},
              ${institution?.id ?? ''}, 15, 133.3333, 0, 2000, -2000, ${leg.event_id})`;
  }

  return {
    institution: institution?.id ?? '',
    investimentos: portfolios['investimentos'] ?? '',
    emergencia: portfolios['emergencia'] ?? '',
    assets,
  };
};
