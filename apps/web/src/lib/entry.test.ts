import type {
  TransactionPreviewResource,
  TransactionResource,
} from '@patrimonio/contracts';
import { describe, expect, it } from 'vitest';

import {
  buildCashBody,
  duplicateRequest,
  buildCashPreviewBody,
  buildConfirmBody,
  buildPayoutBody,
  buildTradeBody,
  buildUpdateBody,
  editFormOf,
  effectRows,
  fieldOfApiMessage,
  inputValue,
  isEditable,
  isPendingPayout,
  issuesToErrors,
  operationTotal,
  parseQuantityInput,
  pickInstitution,
  pickPortfolio,
  todayDateOnly,
} from './entry.js';
import type { CashForm, PayoutForm, TradeForm } from './entry.js';

const LONGO = '0191e5a0-0000-7000-8000-00000000c001';
const RESERVA = '0191e5a0-0000-7000-8000-00000000c002';
const CORRETORA = '0191e5a0-0000-7000-8000-00000000d001';
const ITUB4 = '0191e5a0-0000-7000-8000-00000000a001';
const LANCAMENTO = '0191e5a0-0000-7000-8000-00000000b001';

const trade: TradeForm = {
  assetId: ITUB4,
  date: '2026-10-06',
  settlement: '',
  quantity: '100',
  price: '36,84',
  fees: '',
  portfolioId: LONGO,
  institutionId: CORRETORA,
  note: '',
};

describe('parseQuantityInput', () => {
  it('lê 1.000 como mil, e não como um', () => {
    expect(parseQuantityInput('1.000')).toBe('1000');
    expect(parseQuantityInput('12.345.678')).toBe('12345678');
  });

  it('mantém a fração evidente', () => {
    expect(parseQuantityInput('0.225')).toBe('0.225');
    expect(parseQuantityInput('100,5')).toBe('100.5');
    expect(parseQuantityInput('100')).toBe('100');
  });

  it('recusa o que não é número', () => {
    expect(parseQuantityInput('cem')).toBeNull();
    expect(parseQuantityInput('')).toBeNull();
  });
});

describe('buildTradeBody', () => {
  it('lê 36,84 como decimal e monta o corpo da compra', () => {
    const built = buildTradeBody('buy', trade);

    expect(built).toEqual({
      ok: true,
      body: {
        kind: 'buy',
        portfolio_id: LONGO,
        institution_id: CORRETORA,
        asset_id: ITUB4,
        trade_date: '2026-10-06',
        quantity: '100',
        unit_price: '36.84',
      },
    });
  });

  it('deixa taxa e liquidação em branco para a api sugerir', () => {
    const built = buildTradeBody('buy', trade);

    expect(built.ok && 'fees' in built.body).toBe(false);
    expect(built.ok && 'settlement_date' in built.body).toBe(false);
  });

  it('manda a taxa e a liquidação quando a pessoa as digitou', () => {
    const built = buildTradeBody('sell', {
      ...trade,
      fees: '4,90',
      settlement: '2026-10-08',
    });

    expect(built.ok && built.body.fees).toBe('4.90');
    expect(built.ok && built.body.settlement_date).toBe('2026-10-08');
    expect(built.ok && built.body.kind).toBe('sell');
  });

  it('diz o que falta no campo de cada um', () => {
    const built = buildTradeBody('buy', {
      ...trade,
      assetId: null,
      quantity: '',
      price: 'abc',
      date: '',
      portfolioId: null,
    });

    expect(built).toEqual({
      ok: false,
      errors: {
        asset: 'Escolha o ativo.',
        portfolio: 'Escolha a carteira.',
        date: 'Informe a data.',
        quantity: 'Informe a quantidade.',
        price: 'Informe um valor como 36,84.',
      },
    });
  });

  it('o schema da api recusa preço negativo, no campo do preço', () => {
    const built = buildTradeBody('buy', { ...trade, price: '-1' });

    expect(built.ok).toBe(false);
    expect(!built.ok && built.errors.price).toBe('não pode ser negativo');
  });

  it('lê 1.000 ações como mil', () => {
    const built = buildTradeBody('buy', { ...trade, quantity: '1.000' });

    expect(built.ok && built.body.quantity).toBe('1000');
  });
});

describe('buildCashBody', () => {
  const cash: CashForm = {
    portfolioId: LONGO,
    institutionId: CORRETORA,
    date: '2026-10-01',
    amount: '4.000,00',
    note: '',
  };

  it('monta o aporte de fora do app', () => {
    expect(buildCashBody('deposit', cash)).toEqual({
      ok: true,
      body: {
        kind: 'deposit',
        portfolio_id: LONGO,
        institution_id: CORRETORA,
        trade_date: '2026-10-01',
        amount: '4000.00',
      },
    });
  });

  it('o preview do aporte é o do lançamento de caixa: um real por real', () => {
    const preview = buildCashPreviewBody('deposit', cash);

    expect(preview).toEqual({
      ok: true,
      body: {
        kind: 'deposit',
        portfolio_id: LONGO,
        institution_id: CORRETORA,
        trade_date: '2026-10-01',
        quantity: '4000.00',
        unit_price: '1',
      },
    });
  });
});

describe('buildPayoutBody', () => {
  const payout: PayoutForm = {
    assetId: ITUB4,
    payoutKind: 'jcp',
    recordDate: '2026-09-30',
    paymentDate: '2026-10-20',
    mode: 'per_share',
    amount: '0,22616',
    tax: '',
    portfolioId: LONGO,
    institutionId: CORRETORA,
    received: false,
    note: '',
  };

  it('manda o valor por ação, sem quantidade: ela vem dos lançamentos', () => {
    const built = buildPayoutBody(payout);

    expect(built.ok).toBe(true);
    expect(built.ok && built.body.amount_per_share).toBe('0.22616');
    expect(built.ok && 'quantity' in built.body).toBe(false);
    expect(built.ok && 'gross_amount' in built.body).toBe(false);
  });

  it('manda "a receber" de forma explícita, mesmo com a data já passada', () => {
    const built = buildPayoutBody({ ...payout, paymentDate: '2026-09-01' });

    expect(built.ok && built.body.confirmed).toBe(false);
  });

  it('manda o total bruto quando o provento veio como valor total', () => {
    const built = buildPayoutBody({ ...payout, mode: 'gross', amount: '113,08' });

    expect(built.ok && built.body.gross_amount).toBe('113.08');
    expect(built.ok && 'amount_per_share' in built.body).toBe(false);
  });

  it('o erro do valor cai no campo do modo escolhido', () => {
    const porAcao = buildPayoutBody({ ...payout, amount: '' });
    const total = buildPayoutBody({ ...payout, mode: 'gross', amount: '' });

    expect(!porAcao.ok && porAcao.errors.perShare).toBe('Informe o valor.');
    expect(!total.ok && total.errors.gross).toBe('Informe o valor.');
  });

  it('o IR digitado vai no corpo; em branco a api calcula', () => {
    const digitado = buildPayoutBody({ ...payout, tax: '16,96' });
    const calculado = buildPayoutBody(payout);

    expect(digitado.ok && digitado.body.tax_withheld).toBe('16.96');
    expect(calculado.ok && 'tax_withheld' in calculado.body).toBe(false);
  });
});

const original: TransactionResource = {
  id: LANCAMENTO,
  kind: 'buy',
  trade_date: '2025-03-12',
  settlement_date: '2025-03-14',
  portfolio_id: LONGO,
  asset_id: ITUB4,
  institution_id: CORRETORA,
  quantity: '100.00000000',
  unit_price: '31.40000000',
  fees: '0.00',
  gross_amount: '3140.00',
  tax_withheld: '0.00',
  net_amount: '-3140.00',
  payout_kind: null,
  expected_net_amount: null,
  record_date: null,
  confirmed_at: null,
  event_ratio_from: null,
  event_ratio_to: null,
  note: null,
  idempotency_key: null,
  created_at: '2025-03-12T10:00:00.000Z',
  updated_at: '2025-03-12T10:00:00.000Z',
};

describe('inputValue', () => {
  it('tira os zeros que sobraram da coluna e usa vírgula', () => {
    expect(inputValue('500.00000000')).toBe('500');
    expect(inputValue('31.04000000')).toBe('31,04');
    expect(inputValue('0.22616000')).toBe('0,22616');
    expect(inputValue(null)).toBe('');
  });
});

describe('buildUpdateBody', () => {
  it('sem nenhuma mudança, não há o que salvar', () => {
    const built = buildUpdateBody(original, editFormOf(original), LANCAMENTO);

    expect(built).toEqual({ ok: true, body: {}, changed: [] });
  });

  it('manda só o que mudou, e diz qual campo mudou', () => {
    const built = buildUpdateBody(
      original,
      { ...editFormOf(original), price: '31,04' },
      LANCAMENTO,
    );

    expect(built).toEqual({
      ok: true,
      body: { unit_price: '31.04' },
      changed: ['price'],
    });
  });

  it('31,40 digitado não é mudança de 31.40000000', () => {
    const built = buildUpdateBody(
      original,
      { ...editFormOf(original), price: '31,4' },
      LANCAMENTO,
    );

    expect(built.ok && built.changed).toEqual([]);
  });

  it('trocar de carteira e de data entra no corpo', () => {
    const built = buildUpdateBody(
      original,
      { ...editFormOf(original), portfolioId: RESERVA, date: '2025-03-13' },
      LANCAMENTO,
    );

    expect(built.ok && built.body).toEqual({
      trade_date: '2025-03-13',
      portfolio_id: RESERVA,
    });
  });

  it('apagar a taxa na edição é zerá-la, e não deixá-la como está', () => {
    const comTaxa = { ...original, fees: '4.90' };
    const built = buildUpdateBody(
      comTaxa,
      { ...editFormOf(comTaxa), fees: '' },
      LANCAMENTO,
    );

    expect(built.ok && built.body.fees).toBe('0');
  });

  it('quantidade inválida volta no campo', () => {
    const built = buildUpdateBody(
      original,
      { ...editFormOf(original), quantity: 'x' },
      LANCAMENTO,
    );

    expect(!built.ok && built.errors.quantity).toBe('Informe uma quantidade como 100.');
  });

  it('o IR só entra na edição de provento', () => {
    const compra = buildUpdateBody(
      original,
      { ...editFormOf(original), tax: '5' },
      LANCAMENTO,
    );
    const provento = buildUpdateBody(
      { ...original, kind: 'payout' },
      { ...editFormOf(original), tax: '5' },
      LANCAMENTO,
    );

    expect(compra.ok && 'tax_withheld' in compra.body).toBe(false);
    expect(provento.ok && provento.body.tax_withheld).toBe('5');
  });
});

describe('isEditable e isPendingPayout', () => {
  it('evento corporativo não se edita', () => {
    expect(isEditable(original)).toBe(true);
    expect(isEditable({ ...original, kind: 'corporate_event' })).toBe(false);
  });

  it('provento sem confirmação está a receber', () => {
    expect(isPendingPayout({ ...original, kind: 'payout' })).toBe(true);
    expect(
      isPendingPayout({
        ...original,
        kind: 'payout',
        confirmed_at: '2026-10-20T10:00:00.000Z',
      }),
    ).toBe(false);
    expect(isPendingPayout(original)).toBe(false);
  });
});

describe('buildConfirmBody', () => {
  it('lê o líquido recebido', () => {
    expect(buildConfirmBody({ netAmount: '84,60', note: '' })).toEqual({
      ok: true,
      body: { net_amount: '84.60' },
    });
  });

  it('exige o valor', () => {
    expect(buildConfirmBody({ netAmount: '', note: '' })).toEqual({
      ok: false,
      errors: { netAmount: 'Informe o valor líquido recebido.' },
    });
  });
});

describe('issuesToErrors e fieldOfApiMessage', () => {
  it('o primeiro erro de cada campo vence', () => {
    expect(
      issuesToErrors([
        { path: ['body', 'quantity'], message: 'primeiro' },
        { path: ['body', 'quantity'], message: 'segundo' },
        { path: ['body', 'unit_price'], message: 'preço' },
        { path: ['body', 'desconhecida'], message: 'sem campo' },
      ]),
    ).toEqual({ quantity: 'primeiro', price: 'preço' });
  });

  it('o erro de venda acima da posição cai no campo da quantidade', () => {
    expect(
      fieldOfApiMessage(
        'Não há quantidade suficiente: a posição em 2026-10-06 é de 200.00000000',
      ),
    ).toBe('quantity');
    expect(
      fieldOfApiMessage('A liquidação não pode ser anterior à data da operação'),
    ).toBe('settlement');
    expect(fieldOfApiMessage('Não havia posição em ITUB4 na data-com 2026-05-01')).toBe(
      'recordDate',
    );
    expect(fieldOfApiMessage('O banco caiu')).toBeNull();
  });
});

const preview: TransactionPreviewResource = {
  basis: 'cost',
  total_amount: '3684.00',
  net_amount: '-3684.00',
  position: {
    quantity: { before: '500.00000000', after: '600.00000000' },
    avg_price: { before: '29.10', after: '30.39' },
    cost_basis: { before: '14550.00', after: '18234.00' },
    weight_pct: { before: '5.80', after: '6.90' },
  },
  cash: { before: '7192.87', after: '3508.87' },
  portfolio_cost_basis: { before: '250000.00', after: '253684.00' },
  allocation: {
    category_id: LONGO,
    category_name: 'Ações',
    current_pct: { before: '35.30', after: '36.30' },
    target_pct: '35.00',
    deviation_pp: { before: '0.30', after: '1.30' },
  },
  realized_result: null,
  oversold: false,
};

describe('effectRows', () => {
  it('a compra mostra a posição inteira, na ordem da prancha', () => {
    const rows = effectRows('buy', preview);

    expect(rows.map((row) => row.id)).toEqual([
      'quantity',
      'avg_price',
      'cost_basis',
      'weight',
      'allocation',
      'portfolio_cost',
    ]);
  });

  it('a alocação diz a classe, o alvo e o desvio depois', () => {
    const allocation = effectRows('buy', preview).find((row) => row.id === 'allocation');

    expect(allocation).toEqual({
      id: 'allocation',
      label: 'Ações × alvo da carteira',
      kind: 'allocation',
      currentBefore: '35.30',
      currentAfter: '36.30',
      target: '35.00',
      deviationAfter: '1.30',
    });
  });

  it('sem alvo definido, não há linha de alocação inventada', () => {
    const rows = effectRows('buy', { ...preview, allocation: null });

    expect(rows.some((row) => row.id === 'allocation')).toBe(false);
  });

  it('a venda acrescenta o resultado realizado, sem "antes"', () => {
    const rows = effectRows('sell', { ...preview, realized_result: '-310.00' });
    const realized = rows.find((row) => row.id === 'realized');

    expect(realized).toMatchObject({
      unit: 'signed_money',
      before: null,
      after: '-310.00',
    });
  });

  it('a compra nunca mostra resultado realizado', () => {
    const rows = effectRows('buy', { ...preview, realized_result: '-310.00' });

    expect(rows.some((row) => row.id === 'realized')).toBe(false);
  });

  it('aporte e resgate mostram só o caixa e o custo da carteira', () => {
    expect(effectRows('deposit', preview).map((row) => row.id)).toEqual([
      'cash',
      'portfolio_cost',
    ]);
    expect(effectRows('withdrawal', preview).map((row) => row.id)).toEqual([
      'cash',
      'portfolio_cost',
    ]);
  });

  it('o que não muda é marcado, e não repetido', () => {
    const rows = effectRows('buy', {
      ...preview,
      position: {
        ...preview.position,
        avg_price: { before: '29.10', after: '29.1000' },
      },
    });
    const avg = rows.find((row) => row.id === 'avg_price');

    expect(avg).toMatchObject({ unchanged: true });
  });
});

describe('operationTotal', () => {
  it('a compra mostra o total sem o sinal de saída de caixa', () => {
    expect(operationTotal(preview)).toBe('3684.00');
    expect(operationTotal({ ...preview, net_amount: '2895.00' })).toBe('2895.00');
  });
});

describe('o que o modal sabe antes de abrir', () => {
  const reference = {
    portfolios: [
      { id: LONGO, name: 'Longo prazo' },
      { id: RESERVA, name: 'Reserva' },
    ],
    institutions: [
      { id: CORRETORA, name: 'Corretora A' },
      { id: RESERVA, name: 'Banco C' },
    ],
  };

  it('abre na carteira do escopo, ou na primeira', () => {
    expect(pickPortfolio(reference, RESERVA)).toBe(RESERVA);
    expect(pickPortfolio(reference, null)).toBe(LONGO);
    expect(pickPortfolio(reference, 'inexistente')).toBe(LONGO);
    expect(pickPortfolio({ portfolios: [], institutions: [] }, null)).toBeNull();
  });

  it('abre na última instituição usada, se ela ainda existir', () => {
    expect(pickInstitution(reference, RESERVA)).toBe(RESERVA);
    expect(pickInstitution(reference, 'apagada')).toBe(CORRETORA);
    expect(pickInstitution(reference, null)).toBe(CORRETORA);
  });

  it('hoje é o dia do relógio de quem digita, com zero à esquerda', () => {
    expect(todayDateOnly(new Date(2026, 9, 6, 23, 30))).toBe('2026-10-06');
    expect(todayDateOnly(new Date(2026, 0, 5, 0, 5))).toBe('2026-01-05');
  });
});

describe('duplicar', () => {
  const row = {
    kind: 'buy',
    asset_id: 'a1',
    ticker: 'ITUB4',
    asset_name: 'Itaú',
    portfolio_id: 'p1',
    quantity: '100.00000000',
    unit_price: '31.04000000',
    fees: '0.00000000',
    note: null,
    };

  it('compra leva ativo, carteira e números; a data não vai', () => {
    expect(duplicateRequest(row)).toEqual({
      tab: 'buy',
      asset: { id: 'a1', label: 'ITUB4', name: 'Itaú', held: null },
      portfolioId: 'p1',
      seed: { quantity: '100', price: '31,04', fees: '0', note: '' },
    });
  });

  it('evento corporativo não se duplica', () => {
    expect(duplicateRequest({ ...row, kind: 'corporate_event' })).toBeNull();
  });
});
