import { annotationsByTransaction, taxLedger } from '@patrimonio/calc';
import type { TaxPolicy, TaxableSale } from '@patrimonio/calc';
import type { AssetClass, DateOnly } from '@patrimonio/domain';

import type { TaxMonthWrite } from '../interfaces/projection.repository.js';
import type { TaxAnnotation } from './recalculation.plan.js';

/**
 * A apuração de renda variável é **global**, não por carteira: o limite de isenção
 * olha a soma das vendas do mês em todas elas, e `tax_month` não tem coluna de
 * carteira exatamente por isso.
 *
 * Ela também é recalculada do começo da história, sempre. O saldo de prejuízo a
 * compensar é uma corrente — março depende de janeiro, e 2025 depende de 2024 —, e
 * recalcular só a ponta exigiria confiar num saldo guardado. Saldo guardado é
 * saldo que pode derivar, que é a classe de erro que esta arquitetura existe para
 * não ter. O livro inteiro cabe em memória; a corrente é refeita.
 */
export type TaxSale = {
  readonly transaction_id: string;
  readonly trade_date: DateOnly;
  readonly asset_class: AssetClass;
  readonly proceeds: string;
  readonly result: string;
};

export type TaxesContext = {
  /** Todas as vendas de renda variável, de todas as carteiras, desde o início. */
  readonly sales: readonly TaxSale[];
  /** Limite de isenção e alíquotas, editáveis em Configurações. */
  readonly policy?: TaxPolicy | undefined;
};

export type TaxesPlan = {
  readonly months: readonly TaxMonthWrite[];
  /** O que cada venda recebeu: é o que `realized_result` grava. */
  readonly annotations: ReadonlyMap<string, TaxAnnotation>;
  readonly loss_balance: Readonly<Record<string, string>>;
};

export const planTaxes = (context: TaxesContext): TaxesPlan => {
  const sales: readonly TaxableSale[] = context.sales.map((sale) => ({
    transaction_id: sale.transaction_id,
    trade_date: sale.trade_date,
    asset_class: sale.asset_class,
    proceeds: sale.proceeds,
    result: sale.result,
  }));

  const ledger = taxLedger(sales, context.policy ?? {});

  return {
    months: ledger.months.map((month) => ({
      year: month.year,
      month: month.month,
      asset_class: month.asset_class,
      sales_total: month.sales_total,
      gross_result: month.gross_result,
      exempt: month.exempt,
      loss_carried_forward: month.loss_carried_forward,
    })),
    annotations: annotationsByTransaction(ledger),
    loss_balance: ledger.loss_balance,
  };
};
