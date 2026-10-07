import type { TaxableSale } from '../../tax/variable_income.js';

/**
 * Cenários de apuração conferidos à mão uma vez. Mudança no motor que troque um
 * destes números falha o `pnpm test`, e é o que diferencia um imposto certo de
 * um imposto plausível.
 *
 * Em todos eles `result` é o lucro líquido das taxas e `proceeds` é o valor da
 * venda, que é o que conta para o limite de isenção.
 */
const sale = (
  transaction_id: string,
  trade_date: string,
  asset_class: TaxableSale['asset_class'],
  proceeds: string,
  result: string,
): TaxableSale => ({ transaction_id, trade_date, asset_class, proceeds, result });

/** R$ 18 mil de vendas no mês: abaixo do limite, e o lucro não entra na base. */
export const exemptMonth: readonly TaxableSale[] = [
  sale('v1', '2024-03-05', 'stock', '10000.00', '1500.00'),
  sale('v2', '2024-03-20', 'stock', '8000.00', '500.00'),
];

/** R$ 21 mil no mês: o lucro inteiro é tributável, não só o excedente. */
export const taxableMonth: readonly TaxableSale[] = [
  sale('v1', '2024-04-08', 'stock', '21000.00', '3000.00'),
];

/** FII nunca é isento, mesmo com venda muito abaixo do limite. */
export const fiiAlwaysTaxed: readonly TaxableSale[] = [
  sale('v1', '2024-05-10', 'fii', '5000.00', '800.00'),
];

/** Prejuízo em janeiro reduz a base de março, dentro da mesma classe. */
export const lossThenProfit: readonly TaxableSale[] = [
  sale('v1', '2024-01-15', 'stock', '25000.00', '-2000.00'),
  sale('v2', '2024-03-18', 'stock', '30000.00', '5000.00'),
];

/** O saldo de prejuízo não zera na virada do ano. */
export const lossAcrossYears: readonly TaxableSale[] = [
  sale('v1', '2024-12-20', 'stock', '25000.00', '-1000.00'),
  sale('v2', '2025-02-10', 'stock', '30000.00', '4000.00'),
];

/**
 * Prejuízo num mês isento não vira crédito: a operação que não foi tributada
 * também não dá direito a abater nada depois.
 */
export const lossInExemptMonth: readonly TaxableSale[] = [
  sale('v1', '2024-01-15', 'stock', '10000.00', '-1500.00'),
  sale('v2', '2024-03-18', 'stock', '30000.00', '5000.00'),
];

/** Duas vendas com lucro no mesmo mês dividem o prejuízo compensado. */
export const offsetSplitAcrossSales: readonly TaxableSale[] = [
  sale('v0', '2024-01-10', 'stock', '25000.00', '-2000.00'),
  sale('v1', '2024-03-10', 'stock', '20000.00', '3000.00'),
  sale('v2', '2024-03-25', 'stock', '15000.00', '1000.00'),
];

/** Classes diferentes não compensam entre si. */
export const lossDoesNotCrossClasses: readonly TaxableSale[] = [
  sale('v1', '2024-01-15', 'stock', '25000.00', '-2000.00'),
  sale('v2', '2024-03-18', 'fii', '30000.00', '5000.00'),
];
