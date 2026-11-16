import { describe, expect, it } from 'vitest';
import type { BookRowResource } from '@patrimonio/contracts';
import { aportePrefill } from './ledger_screen.js';
import { toRequest, newDraft } from '../../lib/ledger_entry_form.js';

const row = {
  id: 'previsto-aporte:rec-1:2026-11',
  kind: 'APORTE',
  date: '2026-11-25',
  situation: 'previsto',
  description: 'Aporte Emergência',
  amount: '500.00',
  account_id: 'acc-1',
  portfolio_id: 'pf-1',
  asset_id: 'as-1',
} as BookRowResource;

describe('LAN-06 · lançar aporte previsto', () => {
  it('abre o modal com carteira, ativo, conta e valor, e leva o recorrente no corpo', () => {
    const prefill = aportePrefill(row, '2026-11-11');
    expect(prefill).toMatchObject({
      kind: 'APORTE',
      portfolioId: 'pf-1',
      accountId: 'acc-1',
      quantity: '1',
      unitPrice: '500.00',
      recurringId: 'rec-1',
      date: '2026-11-11',
    });
    const request = toRequest({ ...newDraft('2026-11-11'), ...prefill });
    expect(request.path).toBe('/api/ledger/aportes');
    expect(request.body).toMatchObject({ recurring_id: 'rec-1', account_id: 'acc-1' });
  });
});
