import { describe, expect, it } from 'vitest';

import { addCredit, emptyCreditDraft, moveToInvoice } from './card_item_ops.js';
import {
  findCard,
  invoiceKeyOf,
  invoiceLines,
  invoiceTotal,
  shiftInvoice,
} from './cards.js';
import { seedData, SEED_REFERENCE_DATE } from './seed.js';

const data = seedData();
const entry = data.entries.find(
  (e) =>
    e.kind === 'despesa' &&
    e.historical !== true &&
    e.payments.some((p) => data.cards.some((c) => c.id === p.sourceId)),
)!;
const card = findCard(data, entry.payments[0]!.sourceId)!;
const from = invoiceKeyOf(card, entry.date);
const to = shiftInvoice(from, 1);

describe('mover de fatura', () => {
  it('muda a fatura do lançamento sem mudar a data', () => {
    const original = invoiceLines(data, card, from).find((l) => l.id === entry.id);
    expect(original).toBeDefined();
    const moved = moveToInvoice(data, 'entry', entry.id, card.id, to);
    expect(invoiceLines(moved, card, from).some((l) => l.id === entry.id)).toBe(false);
    const line = invoiceLines(moved, card, to).find((l) => l.id === entry.id);
    expect(line?.moved).toBe(true);
    expect(line?.date).toBe(original!.date);
    expect(invoiceTotal(moved, card, from)).toBe(
      invoiceTotal(data, card, from) - original!.cents,
    );
  });

  it('não move para fatura paga', () => {
    const paid = {
      ...data,
      payments: [
        ...data.payments,
        {
          id: 'p',
          cardId: card.id,
          invoice: to,
          accountId: 'x',
          date: SEED_REFERENCE_DATE,
          cents: 1,
          posted: true,
        } as never,
      ],
    };
    expect(moveToInvoice(paid, 'entry', entry.id, card.id, to)).toBe(paid);
  });
});

describe('estorno ligado ao lançamento', () => {
  it('marca a linha original como estornada', () => {
    const draft = {
      ...emptyCreditDraft(SEED_REFERENCE_DATE),
      subtype: 'estorno' as const,
      description: 'Estorno',
      categoryId: entry.categoryId,
      value: '10,00',
      reversesId: entry.id,
    };
    const next = addCredit(data, card.id, to, draft);
    const line = invoiceLines(next, card, from).find((l) => l.id === entry.id);
    expect(line?.reversed).toBe(true);
  });
});
