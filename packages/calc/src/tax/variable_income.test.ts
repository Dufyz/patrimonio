import { describe, expect, it } from 'vitest';

import {
  exemptMonth,
  fiiAlwaysTaxed,
  lossAcrossYears,
  lossDoesNotCrossClasses,
  lossInExemptMonth,
  lossThenProfit,
  offsetSplitAcrossSales,
  taxableMonth,
} from '../__fixtures__/tax/months.js';
import { annotationsByTransaction, taxLedger } from './variable_income.js';

describe('isenção mensal em ações', () => {
  it('vendas somando R$ 18 mil no mês ficam isentas e o lucro não entra na base', () => {
    const { months } = taxLedger(exemptMonth);
    const march = months[0];

    expect(months).toHaveLength(1);
    expect(march?.sales_total).toBe('18000.00');
    expect(march?.gross_result).toBe('2000.00');
    expect(march?.exempt).toBe(true);
    expect(march?.taxable_base).toBe('0.00');
    expect(march?.tax_due).toBe('0.00');
  });

  it('vendas somando R$ 21 mil tornam o lucro inteiro tributável, não só o excedente', () => {
    const { months } = taxLedger(taxableMonth);

    expect(months[0]?.exempt).toBe(false);
    expect(months[0]?.taxable_base).toBe('3000.00');
    expect(months[0]?.tax_due).toBe('450.00');
  });

  it('FII vendido com lucro nunca é isento, mesmo muito abaixo do limite', () => {
    const { months } = taxLedger(fiiAlwaysTaxed);

    expect(months[0]?.sales_total).toBe('5000.00');
    expect(months[0]?.exempt).toBe(false);
    // A alíquota do FII é 20%, não 15%.
    expect(months[0]?.tax_rate).toBe('20.00');
    expect(months[0]?.tax_due).toBe('160.00');
  });

  it('o limite é parâmetro: lei muda, e mudar o teto não recompila o motor', () => {
    const { months } = taxLedger(taxableMonth, { monthly_exemption_brl: '35000.00' });

    expect(months[0]?.exempt).toBe(true);
    expect(months[0]?.tax_due).toBe('0.00');
  });
});

describe('prejuízo a compensar', () => {
  it('prejuízo de janeiro reduz a base de março', () => {
    const { months, loss_balance } = taxLedger(lossThenProfit);

    expect(months[0]?.gross_result).toBe('-2000.00');
    expect(months[0]?.loss_carried_forward).toBe('2000.00');

    expect(months[1]?.loss_offset).toBe('2000.00');
    expect(months[1]?.taxable_base).toBe('3000.00');
    expect(months[1]?.tax_due).toBe('450.00');
    expect(months[1]?.loss_carried_forward).toBe('0.00');
    expect(loss_balance.stock).toBe('0.00');
  });

  it('o saldo de prejuízo a compensar atravessa o ano', () => {
    const { months } = taxLedger(lossAcrossYears);

    expect(months[0]?.year).toBe(2024);
    expect(months[1]?.year).toBe(2025);
    expect(months[1]?.loss_offset).toBe('1000.00');
    expect(months[1]?.taxable_base).toBe('3000.00');
  });

  it('prejuízo em mês isento não vira crédito para abater depois', () => {
    const { months } = taxLedger(lossInExemptMonth);

    expect(months[0]?.exempt).toBe(true);
    expect(months[0]?.loss_carried_forward).toBe('0.00');

    expect(months[1]?.loss_offset).toBe('0.00');
    expect(months[1]?.taxable_base).toBe('5000.00');
    expect(months[1]?.tax_due).toBe('750.00');
  });

  it('prejuízo de ação não compensa lucro de FII', () => {
    const { months, loss_balance } = taxLedger(lossDoesNotCrossClasses);

    const fii = months.find((month) => month.asset_class === 'fii');

    expect(fii?.loss_offset).toBe('0.00');
    expect(fii?.taxable_base).toBe('5000.00');
    expect(loss_balance.stock).toBe('2000.00');
  });

  it('a compensação do mês é dividida entre as vendas com lucro, sem perder centavo', () => {
    const { sales } = taxLedger(offsetSplitAcrossSales);

    const march = sales.filter((sale) => sale.trade_date.startsWith('2024-03'));

    expect(march.map((sale) => sale.loss_offset)).toEqual(['1500.00', '500.00']);
  });
});

describe('anotação das vendas', () => {
  it('a venda isenta carrega a isenção, que é o que realized_result guarda', () => {
    const annotations = annotationsByTransaction(taxLedger(exemptMonth));

    expect(annotations.get('v1')).toEqual({ exempt: true, loss_offset: '0.00' });
    expect(annotations.get('v2')).toEqual({ exempt: true, loss_offset: '0.00' });
  });

  it('venda sem lançamento associado não entra no mapa', () => {
    const annotations = annotationsByTransaction(
      taxLedger([
        {
          transaction_id: null,
          trade_date: '2024-04-01',
          asset_class: 'stock',
          proceeds: '30000.00',
          result: '1000.00',
        },
      ]),
    );

    expect(annotations.size).toBe(0);
  });

  it('mês sem venda nenhuma não produz apuração', () => {
    expect(taxLedger([]).months).toHaveLength(0);
    expect(taxLedger([]).loss_balance).toEqual({
      stock: '0.00',
      fii: '0.00',
      etf: '0.00',
    });
  });

  it('mês com resultado zero não é tratado como isento por engano', () => {
    const { months } = taxLedger([
      {
        transaction_id: 'v1',
        trade_date: '2024-06-10',
        asset_class: 'etf',
        proceeds: '30000.00',
        result: '0.00',
      },
    ]);

    expect(months[0]?.exempt).toBe(false);
    expect(months[0]?.taxable_base).toBe('0.00');
    expect(months[0]?.loss_carried_forward).toBe('0.00');
  });
});
