import type { StatementEffect, StatementRow } from '@patrimonio/contracts';
import { describe, expect, it } from 'vitest';

import {
  assetLabel,
  effectView,
  entriesLabel,
  groupFromParam,
  groupToParam,
  hasMarketColumns,
  isLedgerEntry,
  monthItems,
  monthName,
  monthTitle,
  periodFromParam,
  periodToParam,
  pruneSelection,
  selectionKinds,
  selectionState,
  sinceLabel,
  statementCsv,
  summaryItems,
  toggleAll,
  toggleSelected,
  typeDetail,
  typeLabel,
  valueCell,
} from './statement.js';

const row = (overrides: Partial<StatementRow> = {}): StatementRow => ({
  id: 'r1',
  kind: 'buy',
  payout_kind: null,
  trade_date: '2026-09-30',
  settlement_date: '2026-10-02',
  portfolio_id: 'p1',
  portfolio_name: 'Longo prazo',
  institution_id: 'i1',
  institution_name: 'Corretora A',
  asset_id: 'a1',
  ticker: 'WEGE3',
  asset_name: 'WEG ON',
  b3_type: 'stock',
  quantity: '100',
  unit_price: '31.20',
  fees: '0.00',
  gross_amount: '3120.00',
  tax_withheld: '0.00',
  net_amount: '-3120.00',
  confirmed_at: null,
  effect: { type: 'average_price', before: '38.20', after: '36.80' },
  ...overrides,
});

describe('URL', () => {
  it('traduz o grupo nos dois sentidos e ignora o que não conhece', () => {
    expect(groupToParam('event')).toBe('eventos');
    expect(groupFromParam('proventos')).toBe('payout');
    expect(groupFromParam('xyz')).toBeNull();
    expect(groupFromParam(null)).toBeNull();
  });

  it('o período padrão não vai para a URL', () => {
    expect(periodToParam(periodFromParam(null))).toBeNull();
    expect(periodToParam({ kind: 'preset', preset: '12m' })).toBe('12m');
  });

  it('escreve mês e data como a prancha', () => {
    expect(monthTitle('2026-10')).toBe('Outubro 2026');
    expect(monthName('2026-08')).toBe('agosto');
    expect(sinceLabel('2021-03-05')).toBe('mar/2021');
    expect(entriesLabel(1)).toBe('1 lançamento');
    expect(entriesLabel(14)).toBe('14 lançamentos');
  });

  it('o rótulo é o código do ativo, ou o nome quando não há código', () => {
    expect(assetLabel(row({ ticker: null, asset_name: 'CDB Banco C' }))).toBe(
      'CDB Banco C',
    );
    expect(assetLabel(row())).toBe('WEGE3');
  });

  it('o subtipo do provento vem em minúsculas', () => {
    expect(typeDetail(row({ kind: 'payout', payout_kind: 'income' }))).toBe('rendimento');
    expect(typeDetail(row())).toBeNull();
  });
});

describe('resumo', () => {
  const summary = {
    count: 10,
    buys: '5721.00',
    sells: '2895.00',
    payouts: '553.55',
  };

  it('traz compras, vendas e proventos, sempre', () => {
    expect(summaryItems(summary).map((item) => item.key)).toEqual([
      'buys',
      'sells',
      'payouts',
    ]);
  });

  it('o subtotal do mês omite o que é zero', () => {
    const items = monthItems({
      ...summary,
      month: '2026-10',
      buys: '0.00',
      sells: '0.00',
      payouts: '127.40',
    });
    expect(items.map((item) => item.label)).toEqual(['proventos']);
  });
});

describe('valor', () => {
  it('compra e venda em módulo, provento com sinal', () => {
    expect(valueCell(row())).toEqual({ value: '3120.00', signed: false });
    expect(valueCell(row({ kind: 'payout', net_amount: '127.40' }))).toEqual({
      value: '127.40',
      signed: true,
    });
  });
});

describe('efeito', () => {
  const text = (effect: StatementEffect, hidden = false): string =>
    effectView(effect, hidden).text;

  it('escreve cada efeito como a prancha', () => {
    expect(text({ type: 'average_price', before: '38.20', after: '36.80' })).toBe(
      'PM R$ 38,20 → R$ 36,80',
    );
    expect(text({ type: 'payout_exempt' })).toBe('isento de IR');
    expect(text({ type: 'payout_receivable', expected: null })).toBe('a receber');
    expect(text({ type: 'none' })).toBe('—');
  });

  it('venda traz o sinal e a isenção', () => {
    const loss = effectView({ type: 'realized', result: '-310.00', exempt: false });
    expect(loss.text).toBe('−R$ 310,00 realizado');
    expect(loss.tone).toBe('negative');
    expect(text({ type: 'realized', result: '150.00', exempt: true })).toBe(
      '+R$ 150,00 realizado · isento',
    );
  });

  it('desdobramento mostra o fator e a quantidade', () => {
    expect(
      text({
        type: 'corporate_event',
        ratio_from: '1.00000000',
        ratio_to: '2.00000000',
        quantity_before: '100.00000000',
        quantity_after: '200.00000000',
      }),
    ).toBe('1:2 · 100 → 200');
  });

  it('com valores ocultos, nenhum número de dinheiro aparece', () => {
    expect(
      text({ type: 'average_price', before: '38.20', after: '36.80' }, true),
    ).not.toMatch(/38|36/);
    expect(text({ type: 'realized', result: '-310.00', exempt: null }, true)).not.toMatch(
      /310/,
    );
  });
});

describe('seleção', () => {
  const rows = [row({ id: 'a' }), row({ id: 'b' }), row({ id: 'c' })];

  it('o estado do cabeçalho segue a seleção', () => {
    expect(selectionState(rows, new Set())).toBe('none');
    expect(selectionState(rows, new Set(['a']))).toBe('some');
    expect(selectionState(rows, new Set(['a', 'b', 'c']))).toBe('all');
  });

  it('marcar tudo e, estando tudo marcado, desmarcar tudo', () => {
    const all = toggleAll(rows, new Set(['a']));
    expect([...all].toSorted()).toEqual(['a', 'b', 'c']);
    expect(toggleAll(rows, all).size).toBe(0);
  });

  it('alternar uma linha não muta o conjunto anterior', () => {
    const before = new Set(['a']);
    const after = toggleSelected(before, 'b');
    expect(before.size).toBe(1);
    expect([...after]).toEqual(['a', 'b']);
    expect(toggleSelected(after, 'a').has('a')).toBe(false);
  });

  it('descarta da seleção o que saiu da página', () => {
    expect([...pruneSelection(rows, new Set(['a', 'z']))]).toEqual(['a']);
    const same = new Set(['a']);
    expect(pruneSelection(rows, same)).toBe(same);
  });

  it('descreve a seleção sem somar', () => {
    expect(
      selectionKinds([row(), row({ id: 'b' }), row({ id: 'c', kind: 'sell' })]),
    ).toBe('2 compras · 1 venda');
    expect(
      selectionKinds([
        row({ kind: 'corporate_event' }),
        row({ kind: 'corporate_event' }),
      ]),
    ).toBe('2 eventos');
  });
});

describe('CSV', () => {
  it('usa ; e vírgula decimal, e não arredonda', () => {
    const csv = statementCsv([row({ quantity: '100.5', unit_price: '31.2012' })]);
    const [header, line] = csv.split('\r\n');
    expect(header).toContain('"Data";"Tipo"');
    expect(line).toContain('"100,5";"31,2012"');
    expect(line).toContain('"PM R$ 38,20 → R$ 36,80"');
  });

  it('texto que parece fórmula vira texto e aspas são escapadas', () => {
    const csv = statementCsv([row({ ticker: null, asset_name: '=1+1 "x"' })]);
    expect(csv).toContain(`"'=1+1 ""x"""`);
  });
});

describe('transferência de custódia', () => {
  const troca = row({
    id: 'c1',
    kind: 'custody_transfer',
    effect: {
      type: 'custody_transfer',
      from_institution: 'Itaú',
      to_institution: 'Nubank',
    },
  });

  it('é rotulada como custódia e o efeito diz de onde e para onde', () => {
    expect(typeLabel(troca)).toBe('Custódia');
    expect(effectView(troca.effect).text).toBe('Itaú → Nubank');
    expect(groupToParam('custody')).toBe('custodia');
    expect(groupFromParam('custodia')).toBe('custody');
  });

  it('não é lançamento: sem colunas de mercado e fora da seleção em lote', () => {
    expect(isLedgerEntry(troca)).toBe(false);
    expect(hasMarketColumns(troca)).toBe(false);

    const compra = row({ id: 'b1' });
    expect([...toggleAll([compra, troca], new Set())]).toEqual(['b1']);
    expect(selectionState([compra, troca], new Set(['b1']))).toBe('all');
  });
});
