import { describe, expect, it } from 'vitest';

import { looksLikeExport, readExport } from './import_json.js';

const document = JSON.stringify({
  format: 'patrimonio-export-v1',
  tables: {
    portfolio: [{ id: 'p1', name: 'Longo prazo' }],
    institution: [{ id: 'i1', name: 'XP' }],
    asset: [{ id: 'a1', ticker: 'itub4', name: 'Itaú', b3_type: 'stock' }],
    transaction: [
      {
        kind: 'buy',
        trade_date: '2024-03-05',
        portfolio_id: 'p1',
        institution_id: 'i1',
        asset_id: 'a1',
        quantity: '100',
        unit_price: '32.41',
        fees: '1.5',
        gross_amount: '3241.00',
      },
      {
        kind: 'deposit',
        trade_date: '2024-03-01',
        portfolio_id: 'p1',
        institution_id: 'i1',
        gross_amount: '500.00',
      },
      { kind: 'corporate_event', trade_date: '2024-04-01' },
      { kind: 'buy', trade_date: 'x', asset_id: 'zz' },
    ],
  },
});

describe('readExport', () => {
  it('converte o livro em linhas de importação e conta o que ignora', () => {
    const read = readExport(document);
    if (!read.ok) throw new Error(read.message);

    // Aporte e resgate de um arquivo antigo não existem mais: ficam de fora.
    expect(read.skipped).toBe(2);
    expect(read.rows).toHaveLength(2);
    expect(read.rows[0]).toMatchObject({
      kind: 'buy',
      ticker: 'ITUB4',
      portfolio_name: 'Longo prazo',
      institution_name: 'XP',
      errors: [],
    });
    expect(read.rows[1]?.errors).toContain('data inválida');
  });

  it('recusa o que não é exportação', () => {
    expect(readExport('{"a":1}').ok).toBe(false);
    expect(readExport('nao json').ok).toBe(false);
    expect(looksLikeExport(' {"x":1}')).toBe(true);
    expect(looksLikeExport('Data;Tipo')).toBe(false);
  });
});
