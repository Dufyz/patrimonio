import { describe, expect, it } from 'vitest';

import { accountBalance, accountLines, accountsOverview } from './accounts.js';
import { indicators } from './ledger.js';
import { SEED_REFERENCE_DATE, seedData } from './seed.js';
import { addTransfer, emptyTransferDraft, validateTransfer } from './transfer_ops.js';

const TODAY = SEED_REFERENCE_DATE;
const data = seedData();
const draft = {
  ...emptyTransferDraft(TODAY, 'itau-corrente'),
  toId: 'nubank-conta',
  value: '500,00',
};

describe('validateTransfer (FIN-403)', () => {
  it('um rascunho completo é válido', () => {
    expect(validateTransfer(data, draft, TODAY)).toEqual({});
  });

  it('exige origem, destino e valor', () => {
    const errors = validateTransfer(data, emptyTransferDraft(TODAY), TODAY);
    expect(Object.keys(errors).sort()).toEqual(['fromId', 'toId', 'value']);
  });

  it('origem e destino não podem ser a mesma conta', () => {
    expect(validateTransfer(data, { ...draft, toId: 'itau-corrente' }, TODAY)).toEqual({
      toId: 'Origem e destino precisam ser contas diferentes.',
    });
  });

  it('benefício e conta arquivada não participam', () => {
    expect(
      validateTransfer(data, { ...draft, toId: 'flex' }, TODAY)['toId'],
    ).toBeDefined();
    const archived = {
      ...data,
      accounts: data.accounts.map((a) =>
        a.id === 'carteira' ? { ...a, archived: true } : a,
      ),
    };
    expect(
      validateTransfer(archived, { ...draft, toId: 'carteira' }, TODAY)['toId'],
    ).toBeDefined();
  });

  it('valor zero e data futura são recusados', () => {
    expect(
      validateTransfer(data, { ...draft, value: '0,00' }, TODAY)['value'],
    ).toBeDefined();
    expect(
      validateTransfer(data, { ...draft, date: '2026-11-01' }, TODAY)['date'],
    ).toBeDefined();
  });
});

describe('addTransfer (CE-06)', () => {
  const next = addTransfer(data, draft, TODAY);

  it('debita a origem e credita o destino; o total em contas não muda', () => {
    expect(accountBalance(next, 'itau-corrente', TODAY)).toBe(261280);
    expect(accountBalance(next, 'nubank-conta', TODAY)).toBe(892035);
    const range = { from: '2026-10-01', to: '2026-10-31' };
    expect(accountsOverview(next, range, TODAY).totalBalance).toBe(1177315);
  });

  it('aparece nos dois extratos com a etiqueta e a descrição', () => {
    const out = accountLines(next, 'itau-corrente', TODAY).at(-1);
    const entered = accountLines(next, 'nubank-conta', TODAY).at(-1);
    expect(out?.description).toBe('Transferência para Nubank Conta');
    expect(out?.tags).toEqual(['transferência']);
    expect(out?.cents).toBe(-50000);
    expect(entered?.description).toBe('Transferência de Itaú Corrente');
    expect(entered?.cents).toBe(50000);
  });

  it('não é receita nem despesa', () => {
    const range = { from: '2026-10-01', to: '2026-10-31' };
    const before = indicators(
      data.entries.filter((e) => e.historical !== true),
      range,
    );
    const after = indicators(
      next.entries.filter((e) => e.historical !== true),
      range,
    );
    expect(after).toEqual(before);
    expect(next.entries).toBe(data.entries);
  });

  it('a descrição opcional vira nota; com erro nada muda', () => {
    const noted = addTransfer(data, { ...draft, description: 'Reserva' }, TODAY);
    expect(accountLines(noted, 'itau-corrente', TODAY).at(-1)?.note).toBe('Reserva');
    expect(addTransfer(data, { ...draft, toId: '' }, TODAY)).toBe(data);
  });

  it('duas transferências recebem identificadores diferentes', () => {
    const twice = addTransfer(next, draft, TODAY);
    expect(new Set(twice.movements.map((m) => m.id)).size).toBe(twice.movements.length);
  });
});
