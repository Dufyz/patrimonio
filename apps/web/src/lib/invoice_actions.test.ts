import { describe, expect, it } from 'vitest';

import type { InvoiceLineResource } from '../api/invoice.js';
import {
  canReverse,
  itemRequest,
  readOnly,
  reversalMonth,
  reversalRequest,
  validateItem,
} from './invoice_actions.js';

const line = (over: Partial<InvoiceLineResource> = {}): InvoiceLineResource => ({
  id: 'l1',
  origin: 'entry',
  block: 'compras',
  date: '2026-11-02',
  description: 'Mercado',
  category_id: 'c1',
  amount: '100.00',
  installment: null,
  subtype: null,
  forecast: false,
  reversed: false,
  moved: false,
  ...over,
});

describe('invoice_actions', () => {
  it('fatura paga é somente leitura e nada pode ser estornado nela', () => {
    expect(readOnly('paga')).toBe(true);
    expect(canReverse(line(), 'paga')).toBe(false);
    expect(canReverse(line(), 'aberta')).toBe(true);
  });

  it('só compra e parcela são estornáveis, uma vez só', () => {
    expect(canReverse(line({ block: 'creditos' }), 'aberta')).toBe(false);
    expect(canReverse(line({ block: 'encargos' }), 'aberta')).toBe(false);
    expect(canReverse(line({ reversed: true }), 'aberta')).toBe(false);
  });

  it('estorno vai para a primeira fatura sem pagamento a partir da exibida', () => {
    expect(reversalMonth('2026-10', ['2026-09', '2026-11', '2026-12'])).toBe('2026-11');
    expect(reversalMonth('2026-12', ['2026-09'])).toBeNull();
    expect(reversalRequest(line(), '2026-11')).toEqual({
      kind: 'credito',
      subtype: 'estorno',
      invoice_month: '2026-11',
      description: 'Estorno: Mercado',
      amount: '100.00',
      category_id: 'c1',
      reverses_id: 'l1',
    });
  });

  it('encargo exige categoria; valor e descrição obrigatórios', () => {
    const draft = {
      kind: 'encargo',
      subtype: 'juros',
      description: 'Juros',
      amount: '12,50',
      categoryId: '',
      month: '2026-11',
    } as const;
    expect(validateItem(draft).categoryId).toBeTruthy();
    expect(validateItem({ ...draft, categoryId: 'c9' })).toEqual({});
    expect(validateItem({ ...draft, categoryId: 'c9', amount: '0' }).amount).toBeTruthy();
    expect(itemRequest({ ...draft, categoryId: 'c9' })).toMatchObject({
      amount: '12.50',
      category_id: 'c9',
    });
    expect(
      itemRequest({ ...draft, kind: 'credito', subtype: 'cashback' }),
    ).not.toHaveProperty('category_id');
  });
});
