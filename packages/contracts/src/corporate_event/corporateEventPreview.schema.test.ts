import { describe, expect, it } from 'vitest';

import { previewTransactionSchema } from '../transaction/previewTransaction.schema.js';

const ASSET = '3fa85f64-5717-4562-b3fc-2c963f66afa6';

const event = (overrides: Record<string, unknown> = {}) => ({
  body: {
    kind: 'corporate_event',
    event_kind: 'split',
    asset_id: ASSET,
    record_date: '2026-06-10',
    ratio_from: '1',
    ratio_to: '2',
    ...overrides,
  },
});

describe('preview de evento corporativo', () => {
  it('aceita desdobramento, grupamento e bonificação com o fator no sentido certo', () => {
    expect(previewTransactionSchema.safeParse(event()).success).toBe(true);
    expect(
      previewTransactionSchema.safeParse(
        event({ event_kind: 'reverse_split', ratio_from: '10', ratio_to: '1' }),
      ).success,
    ).toBe(true);
    expect(
      previewTransactionSchema.safeParse(
        event({ event_kind: 'bonus', ratio_from: '10', ratio_to: '11' }),
      ).success,
    ).toBe(true);
  });

  it('recusa o fator que contradiz o tipo', () => {
    expect(
      previewTransactionSchema.safeParse(event({ event_kind: 'reverse_split' })).success,
    ).toBe(false);
    expect(
      previewTransactionSchema.safeParse(event({ ratio_from: '2', ratio_to: '1' }))
        .success,
    ).toBe(false);
  });

  it('o lançamento comum segue valendo', () => {
    const parsed = previewTransactionSchema.safeParse({
      body: {
        kind: 'buy',
        portfolio_id: ASSET,
        institution_id: ASSET,
        asset_id: ASSET,
        trade_date: '2026-06-10',
        quantity: '1',
        unit_price: '1',
      },
    });

    expect(parsed.success).toBe(true);
  });
});
