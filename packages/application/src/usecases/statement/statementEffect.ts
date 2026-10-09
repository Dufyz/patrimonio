import type { EntryEffect } from '@patrimonio/calc';

import type { StatementLedgerRow } from '../../interfaces/statement.repository.js';

/**
 * O que um lançamento mudou, em forma que a tela traduz numa frase curta.
 *
 * Este módulo só **escolhe** qual frase vale para qual lançamento. Os números —
 * preço médio de antes e de depois, resultado realizado, quantidade — vêm do
 * motor (`ledgerEffects`), que é o mesmo passo que o recálculo usa. A escolha é
 * a parte que tem regra de negócio, e por isso tem teste próprio: dividendo e
 * rendimento de FII são isentos, JCP vem com imposto retido, juros de renda
 * fixa não são nem uma coisa nem outra no pagamento.
 */
export type StatementEffectView =
  | { readonly type: 'average_price'; readonly before: string; readonly after: string }
  | { readonly type: 'position_opened'; readonly avg_price: string }
  | {
      readonly type: 'realized';
      readonly result: string;
      readonly exempt: boolean | null;
    }
  | { readonly type: 'payout_exempt' }
  | { readonly type: 'payout_withheld'; readonly tax: string }
  | { readonly type: 'payout_receivable'; readonly expected: string | null }
  | { readonly type: 'cost_reduction'; readonly amount: string }
  | { readonly type: 'cash_in' }
  | { readonly type: 'cash_out' }
  | {
      readonly type: 'transfer';
      readonly direction: 'in' | 'out';
      readonly counterpart: string | null;
    }
  | {
      readonly type: 'corporate_event';
      readonly ratio_from: string;
      readonly ratio_to: string;
      readonly quantity_before: string;
      readonly quantity_after: string;
    }
  | { readonly type: 'none' };

const NONE: StatementEffectView = { type: 'none' };

/** `0`, `0.00` e `0.00000000` são o mesmo zero; `0.01` não é. */
const isZero = (value: string): boolean => /^-?0(\.0+)?$/.test(value);

const absolute = (value: string): string =>
  value.startsWith('-') ? value.slice(1) : value;

export const statementEffect = (
  row: StatementLedgerRow,
  effect: EntryEffect | undefined,
): StatementEffectView => {
  switch (row.kind) {
    case 'buy':
      if (effect === undefined) return NONE;
      return isZero(effect.before.quantity)
        ? { type: 'position_opened', avg_price: effect.after.avg_price }
        : {
            type: 'average_price',
            before: effect.before.avg_price,
            after: effect.after.avg_price,
          };

    case 'sell':
      if (effect === undefined || effect.realized_result === null) return NONE;
      return {
        type: 'realized',
        result: effect.realized_result,
        exempt: row.realized_exempt,
      };

    case 'payout':
      return payoutEffect(row);

    case 'deposit':
      return { type: 'cash_in' };

    case 'withdrawal':
      return { type: 'cash_out' };

    case 'transfer':
      return {
        type: 'transfer',
        // A perna que sai tem valor líquido negativo — a mesma convenção do motor.
        direction: row.net_amount.startsWith('-') ? 'out' : 'in',
        counterpart: row.transfer_counterpart,
      };

    case 'corporate_event':
      if (
        effect === undefined ||
        row.event_ratio_from === null ||
        row.event_ratio_to === null
      ) {
        return NONE;
      }
      return {
        type: 'corporate_event',
        ratio_from: row.event_ratio_from,
        ratio_to: row.event_ratio_to,
        quantity_before: effect.before.quantity,
        quantity_after: effect.after.quantity,
      };
  }
};

const payoutEffect = (row: StatementLedgerRow): StatementEffectView => {
  // O provento a receber ainda não é dinheiro, e a frase diz isso antes de
  // qualquer coisa sobre imposto: o imposto só existe depois do pagamento.
  if (row.confirmed_at === null) {
    return { type: 'payout_receivable', expected: row.expected_net_amount };
  }

  if (row.payout_kind === 'amortization') {
    return { type: 'cost_reduction', amount: absolute(row.net_amount) };
  }

  if (!isZero(row.tax_withheld)) {
    return { type: 'payout_withheld', tax: row.tax_withheld };
  }

  // Dividendo e rendimento de FII são isentos. Juros de renda fixa e JCP sem
  // retenção não são "isentos": o imposto deles não passa pelo pagamento, e
  // chamá-los assim seria afirmar o que ninguém conferiu.
  return row.payout_kind === 'dividend' || row.payout_kind === 'income'
    ? { type: 'payout_exempt' }
    : NONE;
};
