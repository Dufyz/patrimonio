import type { BookRowResource } from '@patrimonio/contracts';
import { describe, expect, it } from 'vitest';

import {
  batchTotal,
  canMoveInvoice,
  cardOf,
  reversalBody,
  canDelete,
  canMove,
  deletePath,
  moveBody,
  recategorizeBody,
} from './ledger_batch.js';

const row = (over: Partial<BookRowResource>): BookRowResource => ({
  id: 'r1',
  kind: 'DESPESA',
  date: '2026-11-10',
  situation: 'lancado',
  description: 'Mercado',
  amount: '120.50',
  account_id: 'a1',
  to_account_id: null,
  card_id: null,
  category_id: 'c1',
  portfolio_id: null,
  asset_id: null,
  asset_class: null,
  quantity: null,
  unit_price: null,
  fees: null,
  entry: {
    kind: 'despesa',
    description: 'Mercado',
    date: '2026-11-10',
    category_id: 'c1',
    amount: '120.50',
    status: 'lancada',
    payments: [{ source_type: 'conta', source_id: 'a1' }],
  },
  event_id: null,
  ...over,
});

describe('LAN-08 · lote', () => {
  it('cada tipo tem a sua rota de exclusão; pagamento de fatura não tem', () => {
    expect(deletePath(row({}))).toBe('/api/finance/entries/r1');
    expect(deletePath(row({ kind: 'TRANSFERENCIA' }))).toBe('/api/finance/transfers/r1');
    expect(deletePath(row({ kind: 'APORTE' }))).toBe('/api/transactions/r1');
    expect(deletePath(row({ kind: 'PAGAMENTO_FATURA' }))).toBeNull();
    expect(canDelete(row({ kind: 'PAGAMENTO_FATURA' }))).toBe(false);
  });

  it('a soma do lote é exata, em centavos', () => {
    expect(
      batchTotal([
        row({ amount: '0.10' }),
        row({ amount: '0.20' }),
        row({ amount: '1000.05' }),
      ]),
    ).toBe('1000.35');
  });

  it('recategorizar troca só a categoria e mantém o resto do lançamento', () => {
    const body = recategorizeBody(row({}), 'c2');
    expect(body).toMatchObject({
      kind: 'despesa',
      description: 'Mercado',
      amount: '120.50',
      category_id: 'c2',
      payments: [{ source_type: 'conta', source_id: 'a1' }],
    });
  });

  it('mover troca a conta; pagamento no cartão não se move', () => {
    expect(moveBody(row({}), 'a2')).toMatchObject({
      payments: [{ source_type: 'conta', source_id: 'a2' }],
    });
    const card = row({
      entry: {
        kind: 'despesa',
        description: 'x',
        date: '2026-11-10',
        category_id: 'c1',
        amount: '10.00',
        payments: [{ source_type: 'cartao', source_id: 'k1' }],
      },
    });
    expect(canMove(card)).toBe(false);
    expect(canMove(row({}))).toBe(true);
  });
});

describe('LAN-07 · cartão', () => {
  const card = {
    id: 'e1',
    kind: 'DESPESA',
    situation: 'lancado',
    date: '2026-11-05',
    description: 'Mercado',
    amount: '120.50',
    entry: {
      kind: 'despesa',
      description: 'Mercado',
      date: '2026-11-05',
      category_id: 'c',
      amount: '120.50',
      payments: [{ source_type: 'cartao', source_id: 'k1' }],
    },
  } as never;
  const account = {
    ...(card as object),
    entry: {
      kind: 'despesa',
      description: 'Mercado',
      date: '2026-11-05',
      category_id: 'c',
      amount: '120.50',
      payments: [{ source_type: 'conta', source_id: 'a1' }],
    },
  } as never;

  it('só despesa lançada no cartão se move de fatura e se estorna', () => {
    expect(cardOf(card)).toBe('k1');
    expect(canMoveInvoice(card)).toBe(true);
    expect(cardOf(account)).toBeNull();
    expect(canMoveInvoice(account)).toBe(false);
  });

  it('o estorno leva o valor todo, o mês da compra e o vínculo', () => {
    expect(reversalBody(card)).toEqual({
      cardId: 'k1',
      invoice_month: '2026-11',
      description: 'Estorno: Mercado',
      amount: '120.50',
      reverses_id: 'e1',
    });
    expect(reversalBody(account)).toBeNull();
  });
});
