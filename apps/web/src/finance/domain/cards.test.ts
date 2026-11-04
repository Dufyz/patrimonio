import { describe, expect, it } from 'vitest';

import { SEED_REFERENCE_DATE } from './seed.js';
import { seedData } from './seed.js';
import {
  cardSummary,
  findCard,
  invoiceKeyOf,
  invoicePeriod,
  invoiceTotal,
  openInvoicesTotal,
  vigenteKey,
} from './cards.js';

const data = seedData();
const TODAY = SEED_REFERENCE_DATE;
const card = (id: string) => findCard(data, id)!;

describe('faturas (RN-41, RN-42)', () => {
  it('identifica a fatura pelo mês de vencimento', () => {
    const nubank = card('nubank-master');
    expect(invoicePeriod(nubank, '2026-11')).toEqual({
      from: '2026-09-29',
      to: '2026-10-28',
    });
    expect(invoiceKeyOf(nubank, '2026-10-28')).toBe('2026-11');
    expect(invoiceKeyOf(nubank, '2026-10-29')).toBe('2026-12');
    const visa = card('itau-visa');
    expect(invoiceKeyOf(visa, '2026-10-23')).toBe('2026-10');
    expect(invoiceKeyOf(visa, '2026-10-24')).toBe('2026-11');
  });
});

describe('totais das pranchas (RN-44, RN-47, RN-48)', () => {
  it('Nubank: fatura de nov/2026', () => {
    const summary = cardSummary(data, card('nubank-master'), TODAY);
    expect(summary.invoice.key).toBe('2026-11');
    expect(summary.usedCents).toBe(348217);
    expect(summary.usedPercent).toBe(61.5);
  });

  it('Itaú: fechada e aberta', () => {
    const visa = cardSummary(data, card('itau-visa'), TODAY);
    const master = cardSummary(data, card('itau-mastercard'), TODAY);
    expect(vigenteKey(data, card('itau-visa'), TODAY)).toBe('2026-10');
    expect(visa.usedCents).toBe(140010);
    expect(visa.usedPercent).toBe(70);
    expect(master.usedCents).toBe(54000);
    expect(master.usedPercent).toBe(13.5);
  });

  it('Faturas abertas soma as vigentes', () => {
    const all = data.cards.map((c) => cardSummary(data, c, TODAY));
    expect(openInvoicesTotal(all)).toBe(542227);
  });

  it('próximas faturas', () => {
    const itau = (key: string) =>
      invoiceTotal(data, card('itau-visa'), key) +
      invoiceTotal(data, card('itau-mastercard'), key);
    expect(itau('2026-10')).toBe(194010);
    expect(itau('2026-11') + invoiceTotal(data, card('nubank-master'), '2026-11')).toBe(
      430388,
    );
  });
});
