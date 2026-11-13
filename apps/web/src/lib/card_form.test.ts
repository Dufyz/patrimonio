import { describe, expect, it } from 'vitest';

import { newCardDraft, toCardRequest, validateCard } from './card_form.js';

describe('card_form', () => {
  const ok = {
    ...newCardDraft('a1'),
    name: 'Nubank',
    last4: '4821',
    limit: '8.000,00',
    closingDay: '5',
    dueDay: '15',
  };

  it('nome único, final de 4 dígitos, limite, dias 1 a 31 e conta pagadora', () => {
    expect(validateCard(ok, [])).toEqual({});
    expect(validateCard(ok, ['nubank']).name).toBeTruthy();
    expect(validateCard({ ...ok, last4: '12' }, []).last4).toBeTruthy();
    expect(validateCard({ ...ok, closingDay: '32' }, []).closingDay).toBeTruthy();
    expect(validateCard({ ...ok, dueDay: '0' }, []).dueDay).toBeTruthy();
    expect(validateCard({ ...ok, payAccountId: '' }, []).payAccountId).toBeTruthy();
    expect(validateCard({ ...ok, limit: 'x' }, []).limit).toBeTruthy();
  });

  it('monta o pedido com limite normalizado e final opcional', () => {
    expect(toCardRequest(ok)).toEqual({
      name: 'Nubank',
      last4: '4821',
      pay_account_id: 'a1',
      limit_amount: '8000.00',
      closing_day: 5,
      due_day: 15,
    });
    expect(toCardRequest({ ...ok, last4: '' })).not.toHaveProperty('last4');
  });
});
