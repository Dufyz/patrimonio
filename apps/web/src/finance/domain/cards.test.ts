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

import { payInvoice } from './invoice_ops.js';
import { accountBalance, accountLines } from './accounts.js';

describe('pagar fatura (RN-50, CE-04)', () => {
  const paid = payInvoice(data, 'itau-visa', '2026-10', TODAY, TODAY);

  it('debita a conta, aparece no extrato como fatura e não cria despesa', () => {
    expect(accountBalance(paid, 'itau-corrente', TODAY)).toBe(
      accountBalance(data, 'itau-corrente', TODAY) - 140010,
    );
    expect(
      accountLines(paid, 'itau-corrente', TODAY).some(
        (l) => l.tags[0] === 'fatura' && l.cents === -140010,
      ),
    ).toBe(true);
    expect(paid.entries).toEqual(data.entries);
  });

  it('não paga duas vezes nem fatura prevista', () => {
    expect(payInvoice(paid, 'itau-visa', '2026-10', TODAY, TODAY)).toBe(paid);
    expect(payInvoice(data, 'nubank-master', '2026-12', TODAY, TODAY)).toBe(data);
  });
});

import { isOverdue, invoiceStatus, invoiceSummary } from './cards.js';

describe('ciclo de vida da fatura (FIN-511, RN-43)', () => {
  const nubank = card('nubank-master');

  it('no dia seguinte ao fechamento a aberta fecha e a próxima abre', () => {
    expect(invoiceStatus(data, nubank, '2026-11', '2026-10-28')).toBe('aberta');
    expect(invoiceStatus(data, nubank, '2026-11', '2026-10-29')).toBe('fechada');
    expect(invoiceStatus(data, nubank, '2026-12', '2026-10-29')).toBe('aberta');
    expect(invoiceStatus(data, nubank, '2027-01', '2026-10-29')).toBe('prevista');
    expect(vigenteKey(data, nubank, '2026-10-29')).toBe('2026-11');
  });

  it('no máximo uma aberta e uma fechada a pagar por cartão', () => {
    for (const day of ['2026-10-10', '2026-10-24', '2026-11-03', '2026-11-30']) {
      for (const c of data.cards) {
        const statuses = ['2026-09', '2026-10', '2026-11', '2026-12', '2027-01'].map(
          (key) => invoiceStatus(data, c, key, day),
        );
        expect(statuses.filter((s) => s === 'aberta').length).toBeLessThanOrEqual(1);
      }
    }
  });

  it('fechada que passou do vencimento sem pagamento "venceu"', () => {
    const visa = card('itau-visa');
    const oct = invoiceSummary(data, visa, '2026-10', '2026-10-30');
    expect(isOverdue(oct, '2026-10-30')).toBe(false);
    expect(isOverdue(oct, '2026-10-31')).toBe(true);
  });

  it('fatura paga nunca volta a fechada', () => {
    const nu = card('nubank-master');
    expect(invoiceStatus(data, nu, '2026-10', '2027-05-01')).toBe('paga');
  });
});
