import { describe, expect, it } from 'vitest';

import { entryEffect, payInvoiceEffect } from './effects.js';
import { emptyEntryDraft } from './entry_ops.js';
import { seedData } from './seed.js';

const TODAY = '2026-10-24';

describe('efeito dos modais', () => {
  it('uma receita muda as receitas do mês e o saldo da conta', () => {
    const data = seedData();
    const account = data.accounts.find((a) => a.type === 'conta')!;
    const category = data.categories.find((c) => c.kind === 'receita')!;
    const rows = entryEffect(
      data,
      {
        ...emptyEntryDraft(TODAY),
        kind: 'receita',
        description: 'Freela',
        value: '1.800,00',
        categoryId: category.id,
        sourceId: account.id,
      },
      TODAY,
    );
    expect(rows).not.toBeNull();
    const month = rows![0]!;
    expect(month.label).toMatch(/^Receitas de /);
    expect(month.after - month.before).toBe(180000);
    const balance = rows!.find((r) => r.hint === 'saldo')!;
    expect(balance.after - balance.before).toBe(180000);
  });

  it('rascunho inválido não tem efeito', () => {
    expect(entryEffect(seedData(), emptyEntryDraft(TODAY), TODAY)).toBeNull();
  });

  it('pagar fatura baixa o saldo da conta pagadora', () => {
    const data = seedData();
    const card = data.cards[0]!;
    const rows = payInvoiceEffect(data, card.id, '2026-10', TODAY, TODAY);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.after).toBeLessThanOrEqual(rows[0]!.before);
  });
});

describe('Efeito de recorrente ao editar', () => {
  it('trocar só o nome não muda nada: o item não é contado de novo', async () => {
    const { recurringEffect } = await import('./effects.js');
    const { draftOf } = await import('./recurring.js');
    const { SEED_RECURRINGS, SEED_REFERENCE_DATE, seedData } = await import('./seed.js');
    const data = seedData();
    const recurring = SEED_RECURRINGS.find((r) => r.kind === 'despesa' && r.active);
    if (recurring === undefined) throw new Error('sem recorrente');
    const draft = { ...draftOf(recurring), name: 'Outro nome' };
    const rows = recurringEffect(data, draft, SEED_REFERENCE_DATE, recurring.id);
    expect(rows?.every((row) => row.before === row.after)).toBe(true);
  });
});
