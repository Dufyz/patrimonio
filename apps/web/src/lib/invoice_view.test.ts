import { describe, expect, it } from 'vitest';

import type { InvoiceLineResource } from '../api/invoice.js';
import {
  exportInvoiceRows,
  filterInvoiceLines,
  neighbours,
  subtotal,
} from './invoice_view.js';

const line = (over: Partial<InvoiceLineResource>): InvoiceLineResource => ({
  id: 'x',
  origin: 'entry',
  block: 'compras',
  date: '2026-11-01',
  description: 'd',
  category_id: null,
  amount: '10.00',
  installment: null,
  subtype: null,
  forecast: false,
  ...over,
});

describe('invoice_view', () => {
  const lines = [
    line({ id: 'a', description: 'Mercado', category_id: 'c1', amount: '100.10' }),
    line({
      id: 'b',
      block: 'parcelas',
      description: 'Notebook',
      category_id: 'c2',
      amount: '500.00',
      installment: { no: 3, total: 10 },
    }),
    line({ id: 'c', block: 'creditos', description: 'Estorno', amount: '50.05' }),
  ];
  const cat = (id: string | null): string =>
    id === 'c1' ? 'Alimentação' : id === 'c2' ? 'Eletrônicos' : '';

  it('busca por descrição e categoria; tipo filtra por bloco', () => {
    expect(filterInvoiceLines(lines, 'alimenta', [], cat).map((l) => l.id)).toEqual([
      'a',
    ]);
    expect(filterInvoiceLines(lines, 'note', [], cat).map((l) => l.id)).toEqual(['b']);
    expect(filterInvoiceLines(lines, '', ['creditos'], cat).map((l) => l.id)).toEqual([
      'c',
    ]);
    expect(subtotal(filterInvoiceLines(lines, '', ['compras', 'parcelas'], cat))).toBe(
      '600.10',
    );
  });

  it('navegador para na mais antiga e na última prevista', () => {
    const months = ['2026-09', '2026-10', '2026-11'];
    expect(neighbours(months, '2026-09')).toEqual({ prev: null, next: '2026-10' });
    expect(neighbours(months, '2026-11')).toEqual({ prev: '2026-10', next: null });
  });

  it('exportação completa: soma com sinal igual ao total da fatura', () => {
    const rows = exportInvoiceRows(lines, cat);
    const sum = rows.slice(1).reduce((acc, r) => acc + Math.round(Number(r[5]) * 100), 0);
    expect(sum).toBe(55005);
    expect(rows[2]?.[4]).toBe('3/10');
  });
});
