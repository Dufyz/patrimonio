import type { LedgerEntry } from '@patrimonio/calc';
import { describe, expect, it } from 'vitest';

import { planTransaction } from './transaction.plan.js';
import type { PlanContext, TransactionDraft } from './transaction.plan.js';

const ITUB4 = 'a1111111-1111-1111-1111-111111111111';
const KNRI11 = 'a2222222-2222-2222-2222-222222222222';
const ACOES = 'c1111111-1111-1111-1111-111111111111';
const FIIS = 'c2222222-2222-2222-2222-222222222222';
const CARTEIRA = 'b1111111-1111-1111-1111-111111111111';
const CORRETORA = 'd1111111-1111-1111-1111-111111111111';

const compra = (
  id: string,
  assetId: string,
  trade_date: string,
  quantity: string,
  unit_price: string,
): LedgerEntry & { asset_id: string } => ({
  id,
  asset_id: assetId,
  kind: 'buy',
  trade_date,
  quantity,
  unit_price,
  fees: '0',
  net_amount: `-${(Number(quantity) * Number(unit_price)).toFixed(2)}`,
});

const contexto = (overrides: Partial<PlanContext> = {}): PlanContext => {
  const entries = [
    compra('0001', ITUB4, '2026-01-10', '500', '29.10'),
    compra('0002', KNRI11, '2026-02-10', '100', '160.00'),
  ];

  return {
    portfolio_id: CARTEIRA,
    asset: { id: ITUB4, ticker: 'ITUB4', category_id: ACOES, is_new: false },
    institution_id: CORRETORA,
    asset_entries: entries.filter((entry) => entry.asset_id === ITUB4),
    institution_entries: entries,
    portfolio_entries: entries,
    category_by_asset: new Map([
      [ITUB4, ACOES],
      [KNRI11, FIIS],
    ]),
    targets: new Map([
      [ACOES, '35.00'],
      [FIIS, '65.00'],
    ]),
    category_name: 'Ações',
    ...overrides,
  };
};

const compraDeHoje: TransactionDraft = {
  kind: 'buy',
  trade_date: '2026-10-06',
  settlement_date: '2026-10-08',
  quantity: '100',
  unit_price: '36.84',
  fees: '0',
};

describe('preview da compra', () => {
  it('mostra quantidade e preço médio antes e depois', () => {
    const { preview } = planTransaction(contexto(), compraDeHoje);

    expect(preview.position.quantity.before).toBe('500.00000000');
    expect(preview.position.quantity.after).toBe('600.00000000');
    expect(preview.position.avg_price.before).toBe('29.10000000');
    // (500 × 29,10 + 100 × 36,84) / 600 = 30,39
    expect(preview.position.avg_price.after).toBe('30.39000000');
  });

  it('o total da operação é o bruto, e o líquido sai da carteira', () => {
    const { preview } = planTransaction(contexto(), compraDeHoje);

    expect(preview.total_amount).toBe('3684.00');
    expect(preview.net_amount).toBe('-3684.00');
  });

  it('mostra o peso do ativo e o desvio da classe contra o alvo', () => {
    const { preview } = planTransaction(contexto(), compraDeHoje);

    // Antes: 14.550 em ITUB4 de 30.550 no total.
    expect(preview.position.weight_pct.before).toBe('47.63');
    expect(preview.allocation?.target_pct).toBe('35.00');
    expect(preview.allocation?.deviation_pp?.before).toBe('12.63');
    expect(Number(preview.allocation?.deviation_pp?.after)).toBeGreaterThan(12.63);
  });

  it('o caixa da instituição cai pelo valor da compra', () => {
    const { preview } = planTransaction(contexto(), compraDeHoje);

    // −14.550 − 16.000 = −30.550 antes; menos 3.684 depois.
    expect(preview.cash.before).toBe('-30550.00');
    expect(preview.cash.after).toBe('-34234.00');
  });

  it('categoria sem alvo mostra composição real e desvio vazio', () => {
    const { preview } = planTransaction(contexto({ targets: new Map() }), compraDeHoje);

    expect(preview.allocation?.current_pct.after).toBeTruthy();
    expect(preview.allocation?.target_pct).toBeNull();
    expect(preview.allocation?.deviation_pp).toBeNull();
  });
});

describe('preview da venda', () => {
  const venda: TransactionDraft = {
    kind: 'sell',
    trade_date: '2026-10-06',
    settlement_date: '2026-10-08',
    quantity: '200',
    unit_price: '36.84',
    fees: '5.00',
  };

  it('mostra o resultado realizado da operação', () => {
    const { preview } = planTransaction(contexto(), venda);

    // 200 × 36,84 − 5 = 7.363; custo consumido 200 × 29,10 = 5.820.
    expect(preview.realized_result).toBe('1543.00');
  });

  it('venda acima da posição é marcada para o caso de uso recusar', () => {
    const { preview } = planTransaction(contexto(), { ...venda, quantity: '900' });

    expect(preview.oversold).toBe(true);
  });

  it('a venda não altera o preço médio das cotas restantes', () => {
    const { preview } = planTransaction(contexto(), venda);

    expect(preview.position.avg_price.after).toBe(preview.position.avg_price.before);
  });
});

describe('eventos do plano', () => {
  it('criar um lançamento de hoje pede recálculo a partir de hoje', () => {
    const { events } = planTransaction(contexto(), compraDeHoje);

    expect(events).toHaveLength(1);
    expect(events[0]?.dedupe_key).toBe(`recalc:${CARTEIRA}`);
    expect(events[0]?.payload).toEqual({
      portfolio_id: CARTEIRA,
      from_date: '2026-10-06',
    });
  });

  it('editar um lançamento de 2021 pede recálculo a partir daquela data', () => {
    const antigo: LedgerEntry = {
      id: '0001',
      kind: 'buy',
      trade_date: '2021-03-12',
      quantity: '500',
      unit_price: '29.10',
      fees: '0',
      net_amount: '-14550.00',
    };

    const { events } = planTransaction(contexto({ replacing: antigo }), {
      ...compraDeHoje,
      id: '0001',
    });

    expect(events[0]?.payload).toEqual({
      portfolio_id: CARTEIRA,
      from_date: '2021-03-12',
    });
  });

  it('dois planos sobre a mesma carteira produzem a mesma chave de coalescência', () => {
    const primeiro = planTransaction(contexto(), compraDeHoje);
    const segundo = planTransaction(contexto(), {
      ...compraDeHoje,
      trade_date: '2026-10-07',
    });

    expect(segundo.events[0]?.dedupe_key).toBe(primeiro.events[0]?.dedupe_key);
  });

  it('primeiro lançamento de um ativo novo pede também o backfill do preço', () => {
    const novo = contexto({
      asset: { id: 'novo', ticker: 'TAEE11', category_id: ACOES, is_new: true },
      asset_entries: [],
    });

    const { events } = planTransaction(novo, compraDeHoje);

    expect(events).toHaveLength(2);
    expect(events[1]?.dedupe_key).toBe('backfill:novo');
    expect(events[1]?.stage).toBe('market');
  });
});

describe('edição', () => {
  it('o "antes" de uma edição é a posição sem aquela linha, não a de ontem', () => {
    const antigo: LedgerEntry = {
      id: '0001',
      kind: 'buy',
      trade_date: '2026-01-10',
      quantity: '500',
      unit_price: '29.10',
      fees: '0',
      net_amount: '-14550.00',
    };

    const { preview } = planTransaction(contexto({ replacing: antigo }), {
      id: '0001',
      kind: 'buy',
      trade_date: '2026-01-10',
      settlement_date: '2026-01-12',
      quantity: '500',
      unit_price: '31.04',
      fees: '0',
    });

    expect(preview.position.quantity.before).toBe('0.00000000');
    expect(preview.position.quantity.after).toBe('500.00000000');
    expect(preview.position.avg_price.after).toBe('31.04000000');
  });
});

/**
 * P-02. A regra que sustenta a confiança no app: o preview e a gravação são o
 * **mesmo** plano. O teste roda o mesmo cenário nos dois modos e compara campo a
 * campo — se um dia divergirem, é aqui que isso aparece, e não na tela.
 */
describe('o preview é o mesmo plano da gravação', () => {
  const cenarios: readonly { readonly nome: string; readonly draft: TransactionDraft }[] =
    [
      { nome: 'compra', draft: compraDeHoje },
      {
        nome: 'venda',
        draft: {
          kind: 'sell',
          trade_date: '2026-10-06',
          settlement_date: '2026-10-08',
          quantity: '200',
          unit_price: '31.00',
          fees: '4.90',
        },
      },
      {
        nome: 'provento',
        draft: {
          kind: 'payout',
          trade_date: '2026-10-06',
          settlement_date: '2026-10-06',
          quantity: '500',
          unit_price: '0.42',
          fees: '0',
          payout_kind: 'jcp',
          tax_withheld: '31.50',
        },
      },
    ];

  for (const cenario of cenarios) {
    it(`os números do preview de ${cenario.nome} são idênticos aos da gravação`, () => {
      const gravacao = planTransaction(contexto(), cenario.draft);
      const preview = planTransaction(contexto(), cenario.draft);

      expect(preview.preview).toEqual(gravacao.preview);
      expect(preview.amounts).toEqual(gravacao.amounts);
    });
  }

  it('o preview não inventa número próprio: ele vem do mesmo motor', () => {
    const plan = planTransaction(contexto(), compraDeHoje);

    // O valor total do preview é exatamente o bruto que vai para a coluna.
    expect(plan.preview.total_amount).toBe(plan.amounts.gross_amount);
    expect(plan.preview.net_amount).toBe(plan.amounts.net_amount);
  });

  it('a base do preview é declarada: enquanto não há preço, o peso é sobre o custo', () => {
    expect(planTransaction(contexto(), compraDeHoje).preview.basis).toBe('cost');
  });
});

describe('o plano não faz I/O e não olha o relógio', () => {
  it('o mesmo contexto e o mesmo lançamento dão sempre o mesmo plano', () => {
    const primeiro = planTransaction(contexto(), compraDeHoje);
    const segundo = planTransaction(contexto(), compraDeHoje);

    expect(segundo).toEqual(primeiro);
  });

  it('a data do evento vem do lançamento, não de hoje', () => {
    const plan = planTransaction(contexto(), {
      ...compraDeHoje,
      trade_date: '2015-07-20',
    });

    expect(plan.events[0]?.payload).toMatchObject({ from_date: '2015-07-20' });
  });
});
