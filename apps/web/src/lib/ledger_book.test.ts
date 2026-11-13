import { describe, expect, it } from 'vitest';

import type { BookRowResource } from '@patrimonio/contracts';

import {
  balanceOf,
  dayLabel,
  detailOf,
  visibleRows,
  overdueNote,
  plannedSection,
  postedBalance,
  sectionsByDay,
  signOf,
} from './ledger_book.js';

const row = (over: Partial<BookRowResource>): BookRowResource => ({
  id: 'x',
  kind: 'DESPESA',
  date: '2026-11-11',
  situation: 'lancado',
  description: 'd',
  amount: '10.00',
  account_id: 'a',
  to_account_id: null,
  card_id: null,
  category_id: null,
  portfolio_id: null,
  asset_id: null,
  asset_class: null,
  quantity: null,
  unit_price: null,
  fees: null,
  entry: null,
  event_id: null,
  ...over,
});

describe('ledger_book', () => {
  it('rotula o dia com o dia da semana', () => {
    expect(dayLabel('2026-11-11')).toBe('Quarta, 11/11');
  });

  it('o sinal vem do tipo', () => {
    expect(signOf('RECEITA')).toBe('+');
    expect(signOf('DESPESA')).toBe('-');
    expect(signOf('APORTE')).toBe('-');
    expect(signOf('EVENTO')).toBe('');
  });

  it('agrupa por dia, mais novo primeiro', () => {
    const s = sectionsByDay([
      row({ id: '1', date: '2026-11-10' }),
      row({ id: '2', date: '2026-11-12' }),
      row({ id: '3', date: '2026-11-12' }),
    ]);
    expect(s.map((x) => [x.date, x.rows.length])).toEqual([
      ['2026-11-12', 2],
      ['2026-11-10', 1],
    ]);
  });

  it('a soma assinada fecha com o saldo do mês', () => {
    const rows = [
      row({ kind: 'RECEITA', amount: '5000.00' }),
      row({ kind: 'DESPESA', amount: '1200.50' }),
      row({ kind: 'APORTE', amount: '800.00', account_id: 'a' }),
      row({ kind: 'APORTE', amount: '999.00', account_id: null }),
      row({ kind: 'DESPESA', amount: '77.00', situation: 'previsto' }),
      row({ kind: 'PROVENTO', amount: '30.00' }),
    ];
    expect(postedBalance(rows)).toBe(
      balanceOf({ totals: { saldo_do_mes: '2999.50' } } as never),
    );
  });

  it('previstos do mais próximo ao mais distante, com vencidos contados', () => {
    const rows = [
      row({ id: 'a', situation: 'previsto', date: '2026-11-20' }),
      row({ id: 'b', situation: 'previsto', date: '2026-11-05' }),
      row({ id: 'c', situation: 'lancado', date: '2026-11-01' }),
    ];
    const p = plannedSection(rows, '2026-11-12');
    expect(p.rows.map((r) => r.id)).toEqual(['b', 'a']);
    expect(p.counter).toBe('2 previstos · 1 vencido');
    expect(overdueNote('2026-11-05', '2026-11-12')).toBe('venceu em 05/11');
    expect(overdueNote('2026-11-20', '2026-11-12')).toBeNull();
  });

  const fmt = {
    money: (v: string) => `R$ ${v}`,
    quantity: (v: string) => v,
    accountName: (id: string) => (id === 'a' ? 'Nubank Conta' : null),
  };

  it('detalhe do aporte com origem em conta ou fora do app', () => {
    const base = row({
      kind: 'APORTE',
      portfolio_id: 'p',
      quantity: '80',
      unit_price: '32.40',
      fees: '0.80',
    });
    expect(detailOf(base, fmt)).toBe('80 × R$ 32.40 + taxas R$ 0.80 · de Nubank Conta');
    expect(detailOf({ ...base, account_id: null }, fmt)).toBe(
      '80 × R$ 32.40 + taxas R$ 0.80 · Fora do app',
    );
    expect(detailOf(row({}), fmt)).toBeNull();
  });

  it('eventos só com o filtro Tipo = Evento', () => {
    const rows = [row({ id: '1' }), row({ id: '2', kind: 'EVENTO' })];
    expect(visibleRows(rows, [])).toHaveLength(1);
    expect(visibleRows(rows, ['EVENTO'])).toHaveLength(2);
  });
});
