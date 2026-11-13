import { describe, expect, it } from 'vitest';

import {
  effectRows,
  FUTURE_DATE_MESSAGE,
  isValid,
  newDraft,
  switchKind,
  OUTSIDE,
  toRequest,
  validateDraft,
} from './ledger_entry_form.js';

const TODAY = '2026-11-13';
const filled = {
  ...newDraft(TODAY, { accountId: 'a1' }),
  description: 'Mercado',
  amount: '12,50',
  categoryId: 'c1',
};

describe('ledger_entry_form', () => {
  it('contexto preenche a conta; tipo inicial é despesa', () => {
    const d = newDraft(TODAY, { accountId: 'a1' });
    expect(d.kind).toBe('DESPESA');
    expect(d.accountId).toBe('a1');
    expect(d.date).toBe(TODAY);
  });

  it('trocar de tipo mantém os campos compatíveis e limpa a categoria', () => {
    const d = switchKind(filled, 'RECEITA');
    expect(d).toMatchObject({
      kind: 'RECEITA',
      description: 'Mercado',
      amount: '12,50',
      categoryId: '',
    });
  });

  it('recusa data futura com a mensagem de RN-03', () => {
    const errors = validateDraft({ ...filled, date: '2026-12-01' }, TODAY);
    expect(errors.date).toBe(FUTURE_DATE_MESSAGE);
  });

  it('valida valor > 0 e campos obrigatórios', () => {
    expect(isValid(validateDraft(filled, TODAY))).toBe(true);
    expect(validateDraft({ ...filled, amount: '0' }, TODAY).amount).toBeDefined();
    expect(
      validateDraft({ ...filled, description: ' ' }, TODAY).description,
    ).toBeDefined();
  });

  it('monta o corpo com ponto decimal e pagamento pela conta', () => {
    expect(toRequest(filled).body).toMatchObject({
      kind: 'despesa',
      amount: '12.50',
      payments: [{ source_type: 'conta', source_id: 'a1' }],
    });
  });

  it('efeito: saldo da conta e mês em centavos', () => {
    const rows = effectRows({
      accounts: [{ account_id: 'a', name: 'Nubank', before: '100.00', after: '87.50' }],
      months: [],
      warnings: [],
    });
    expect(rows).toEqual([{ label: 'Saldo · Nubank', before: 10000, after: 8750 }]);
  });

  it('transferência: origem e destino distintos, sem categoria, vai para /transfers', () => {
    const t = {
      ...switchKind(filled, 'TRANSFERENCIA'),
      description: '',
      toAccountId: 'a2',
    };
    expect(isValid(validateDraft(t, TODAY))).toBe(true);
    expect(validateDraft({ ...t, toAccountId: 'a1' }, TODAY).toAccountId).toBeDefined();
    expect(toRequest(t)).toMatchObject({
      path: '/api/finance/transfers',
      body: { from_account_id: 'a1', to_account_id: 'a2', amount: '12.50', note: null },
    });
  });

  it('pagamento de fatura: cartão obrigatório, vai para /invoices/:mês/payments', () => {
    const base = { ...switchKind(filled, 'PAGAMENTO_FATURA'), description: '' };
    expect(validateDraft(base, TODAY).cardId).toBeDefined();
    const pay = {
      ...base,
      cardId: 'k1',
      month: '2026-11',
      accountId: 'a1',
      amount: '450,10',
    };
    expect(isValid(validateDraft(pay, TODAY))).toBe(true);
    expect(toRequest(pay)).toEqual({
      path: '/api/finance/cards/k1/invoices/2026-11/payments',
      body: { account_id: 'a1', date: TODAY, amount: '450.10' },
    });
  });

  const asset = { id: 'x1', label: 'BOVA11', name: 'iShares', held: '10' };
  const aporte = {
    ...switchKind(filled, 'APORTE'),
    portfolioId: 'p1',
    institutionId: 'i1',
    asset,
    quantity: '80',
    unitPrice: '32,40',
    fees: '0,80',
    accountId: 'a1',
  };

  it('aporte: exige ativo da lista e vai para /ledger/aportes', () => {
    expect(isValid(validateDraft(aporte, TODAY))).toBe(true);
    expect(validateDraft({ ...aporte, asset: null }, TODAY).asset).toBeDefined();
    expect(toRequest(aporte)).toEqual({
      path: '/api/ledger/aportes',
      body: {
        portfolio_id: 'p1',
        institution_id: 'i1',
        trade_date: TODAY,
        quantity: '80',
        unit_price: '32.40',
        fees: '0.80',
        account_id: 'a1',
        asset_id: 'x1',
      },
    });
  });

  it('aporte fora do app grava account_id nulo', () => {
    expect(toRequest({ ...aporte, accountId: OUTSIDE }).body).toMatchObject({
      account_id: null,
    });
  });

  it('resgate: quantidade acima da posição é erro; despesa ligada exige conta e categoria', () => {
    const resgate = { ...aporte, kind: 'RESGATE' as const };
    expect(validateDraft({ ...resgate, quantity: '11' }, TODAY).quantity).toMatch(
      /passa da posição/,
    );
    const linked = { ...resgate, quantity: '5', linkExpense: true, accountId: OUTSIDE };
    const errors = validateDraft(linked, TODAY);
    expect(errors.accountId).toBeDefined();
    expect(errors.categoryId).toBeDefined();
    const ok = { ...linked, accountId: 'a1', categoryId: 'c1', description: 'Reserva' };
    expect(isValid(validateDraft(ok, TODAY))).toBe(true);
    expect(toRequest(ok).body).toMatchObject({
      linked_expense: { category_id: 'c1', description: 'Reserva' },
    });
  });
});
