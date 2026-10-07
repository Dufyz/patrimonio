import { Decimal } from 'decimal.js';

import type { LedgerKind } from './ledger.js';

/**
 * O valor bruto e o valor líquido de um lançamento, calculados num lugar só. O
 * sinal do líquido é o que diz a direção do dinheiro: negativo sai da carteira,
 * positivo entra. É dele que o caixa da instituição sai, e é por isso que ele
 * não pode ser digitado em uma tela e recalculado em outra.
 */
export type AmountInput = {
  readonly kind: LedgerKind;
  readonly quantity: string;
  readonly unit_price: string;
  readonly fees: string;
  readonly tax_withheld?: string | undefined;
  /** Transferência: a perna que sai leva o sinal negativo. */
  readonly outgoing?: boolean | undefined;
};

export type Amounts = {
  readonly gross_amount: string;
  readonly net_amount: string;
};

const MONEY_DP = 2;

export const amountsFor = (input: AmountInput): Amounts => {
  const quantity = new Decimal(input.quantity === '' ? 0 : input.quantity);
  const price = new Decimal(input.unit_price === '' ? 0 : input.unit_price);
  const fees = new Decimal(input.fees === '' ? 0 : input.fees);
  const tax = new Decimal(
    input.tax_withheld === undefined || input.tax_withheld === ''
      ? 0
      : input.tax_withheld,
  );

  const gross = quantity.times(price).toDecimalPlaces(MONEY_DP);

  const net = ((): Decimal => {
    switch (input.kind) {
      case 'buy':
        // Comprar tira dinheiro da carteira, e as taxas saem junto.
        return gross.plus(fees).negated();
      case 'sell':
        return gross.minus(fees);
      case 'deposit':
        return gross.minus(fees);
      case 'withdrawal':
        return gross.plus(fees).negated();
      case 'payout':
        // JCP tem IR retido na fonte: o que entra é o líquido.
        return gross.minus(tax).minus(fees);
      case 'transfer':
        return input.outgoing === true ? gross.negated() : gross;
      case 'corporate_event':
        // Evento corporativo não move dinheiro: muda quantidade e preço médio.
        return new Decimal(0);
    }
  })();

  return {
    gross_amount: gross.toFixed(MONEY_DP),
    net_amount: net.toDecimalPlaces(MONEY_DP).toFixed(MONEY_DP),
  };
};
