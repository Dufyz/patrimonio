import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { invoiceLines } from './cards.js';
import type { FinSnapshot } from '@patrimonio/domain';

/**
 * CRT-09 · Toda compra de cartão é lançamento: nenhum item de fatura do tipo
 * `compra` pode existir sem lançamento de despesa correspondente. Itens só
 * podem ser crédito ou encargo, e a compra entra em Despesas na data da compra.
 */
const seeds = join(__dirname, '..', '..', '..', 'db', 'src', 'seeds');
const load = (name: string): FinSnapshot =>
  (JSON.parse(readFileSync(join(seeds, name), 'utf8')) as { snapshot?: FinSnapshot })
    .snapshot ?? (JSON.parse(readFileSync(join(seeds, name), 'utf8')) as FinSnapshot);

describe.each(['finance_demo.json', 'unified_fixture.json'])('%s', (file) => {
  const data = load(file);

  it('nenhum item de fatura é compra: compra é sempre lançamento', () => {
    const orphans = data.card_items.filter((i) => i.kind === 'compra');
    expect(orphans.map((i) => i.id)).toEqual([]);
  });

  it('toda despesa em cartão aparece como linha de compra ou parcela da fatura', () => {
    for (const entry of data.entries) {
      if (entry.kind !== 'despesa') continue;
      for (const part of entry.payments.filter((p) => p.source_type === 'cartao')) {
        const card = data.cards.find((c) => c.id === part.source_id);
        if (card === undefined || part.invoice_month === null) continue;
        const lines = invoiceLines(data, card, part.invoice_month);
        expect(lines.some((l) => l.id === entry.id)).toBe(true);
      }
    }
  });
});
