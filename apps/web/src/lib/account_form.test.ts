import { describe, expect, it } from 'vitest';

import {
  needsExplicitConfirm,
  newAccountDraft,
  toAccountRequest,
  validateAccount,
} from './account_form.js';

describe('account_form', () => {
  const ok = { ...newAccountDraft('2026-11-13'), name: 'Nubank' };

  it('nome obrigatório e único (sem diferenciar caixa)', () => {
    expect(validateAccount({ ...ok, name: ' ' }, []).name).toBeTruthy();
    expect(validateAccount(ok, ['nubank']).name).toBe(
      'Já existe uma conta com esse nome.',
    );
    expect(validateAccount(ok, ['Itaú'])).toEqual({});
  });

  it('saldo de abertura aceita vírgula e rejeita negativo ou lixo', () => {
    expect(validateAccount({ ...ok, openingAmount: '1.234,56' }, [])).toEqual({});
    expect(
      validateAccount({ ...ok, openingAmount: '-1' }, []).openingAmount,
    ).toBeTruthy();
    expect(
      validateAccount({ ...ok, openingAmount: 'abc' }, []).openingAmount,
    ).toBeTruthy();
  });

  it('monta o pedido com no patrimônio ligado por padrão', () => {
    expect(
      toAccountRequest({ ...ok, openingAmount: '1.234,56', institution: ' ' }),
    ).toEqual({
      name: 'Nubank',
      type: 'corrente',
      institution: null,
      role: '',
      role_tag: null,
      opening_amount: '1234.56',
      opening_date: '2026-11-13',
      in_wealth: true,
    });
  });

  it('arquivar com saldo diferente de zero exige confirmação explícita', () => {
    expect(needsExplicitConfirm('0.00')).toBe(false);
    expect(needsExplicitConfirm('0')).toBe(false);
    expect(needsExplicitConfirm('12.50')).toBe(true);
    expect(needsExplicitConfirm('-3.00')).toBe(true);
  });
});
