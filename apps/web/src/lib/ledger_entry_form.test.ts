import { describe, expect, it } from 'vitest';

import {
  effectRows,
  FUTURE_DATE_MESSAGE,
  isValid,
  newDraft,
  switchKind,
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
});
