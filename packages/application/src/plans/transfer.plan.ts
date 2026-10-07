import {
  applyLedger,
  costBasisByAsset,
  moneyDifference,
  sumValues,
  totalAmount,
} from '@patrimonio/calc';
import type { LedgerEntry } from '@patrimonio/calc';
import type { DateOnly } from '@patrimonio/domain';

import type { BeforeAfter } from './transaction.plan.js';

/**
 * Transferir é reclassificação interna, não venda: o preço médio é preservado
 * nas duas pontas, não há resultado realizado e não há imposto. O patrimônio
 * total não muda — só a leitura por propósito —, e é isso que o preview mostra.
 */
export type TransferContext = {
  readonly from_portfolio_id: string;
  readonly to_portfolio_id: string;
  readonly asset_id: string;
  readonly trade_date: DateOnly;
  /** Lançamentos do ativo na carteira de origem. */
  readonly origin_entries: readonly LedgerEntry[];
  /** Lançamentos do ativo na carteira de destino. */
  readonly destination_entries: readonly LedgerEntry[];
  /** O livro de cada carteira, para o valor total antes e depois. */
  readonly origin_portfolio_entries: readonly (LedgerEntry & {
    readonly asset_id: string | null;
  })[];
  readonly destination_portfolio_entries: readonly (LedgerEntry & {
    readonly asset_id: string | null;
  })[];
};

export type TransferPreview = {
  readonly basis: 'cost';
  readonly quantity: string;
  /** O preço médio da origem, que viaja com a posição. */
  readonly avg_price: string;
  readonly amount: string;
  readonly origin: {
    readonly portfolio_id: string;
    readonly quantity: BeforeAfter;
    readonly avg_price: BeforeAfter;
    readonly cost_basis: BeforeAfter;
    readonly portfolio_cost_basis: BeforeAfter;
  };
  readonly destination: {
    readonly portfolio_id: string;
    readonly quantity: BeforeAfter;
    readonly avg_price: BeforeAfter;
    readonly cost_basis: BeforeAfter;
    readonly portfolio_cost_basis: BeforeAfter;
  };
  /** A soma das duas carteiras antes e depois: a diferença é zero. */
  readonly total: BeforeAfter;
  readonly total_change: string;
  readonly available_quantity: string;
  readonly oversold: boolean;
};

export type TransferLeg = {
  readonly portfolio_id: string;
  readonly outgoing: boolean;
  readonly quantity: string;
  readonly unit_price: string;
  readonly amount: string;
};

export type TransferPlan = {
  readonly legs: readonly [TransferLeg, TransferLeg];
  readonly preview: TransferPreview;
};

const leg = (
  portfolioId: string,
  outgoing: boolean,
  quantity: string,
  unitPrice: string,
  amount: string,
): TransferLeg => ({
  portfolio_id: portfolioId,
  outgoing,
  quantity,
  unit_price: unitPrice,
  amount,
});

export const planTransfer = (
  context: TransferContext,
  request: { readonly quantity: string },
): TransferPlan => {
  const originBefore = applyLedger(context.origin_entries, {
    until: context.trade_date,
  });
  const destinationBefore = applyLedger(context.destination_entries, {
    until: context.trade_date,
  });

  const avgPrice = originBefore.position.avg_price;
  const quantity = request.quantity;

  // O custo que viaja é a quantidade pelo preço médio da origem: é isso que
  // preserva o preço médio nas duas pontas.
  const amount = totalAmount(quantity, avgPrice);

  const outEntry: LedgerEntry = {
    kind: 'transfer',
    trade_date: context.trade_date,
    quantity,
    unit_price: avgPrice,
    fees: '0',
    // O sinal do líquido é o que diz a direção da perna.
    net_amount: `-${amount}`,
  };

  const originAfter = applyLedger([
    ...context.origin_entries,
    { ...outEntry, net_amount: `-${amount}` },
  ]);
  const destinationAfter = applyLedger([
    ...context.destination_entries,
    { ...outEntry, net_amount: amount },
  ]);

  const originTotalBefore = sumValues(
    costBasisByAsset(context.origin_portfolio_entries).values(),
  );
  const destinationTotalBefore = sumValues(
    costBasisByAsset(context.destination_portfolio_entries).values(),
  );

  const originTotalAfter = sumValues(
    costBasisByAsset([
      ...context.origin_portfolio_entries,
      { ...outEntry, net_amount: `-${amount}`, asset_id: context.asset_id },
    ]).values(),
  );
  const destinationTotalAfter = sumValues(
    costBasisByAsset([
      ...context.destination_portfolio_entries,
      { ...outEntry, net_amount: amount, asset_id: context.asset_id },
    ]).values(),
  );

  const totalBefore = sumValues([originTotalBefore, destinationTotalBefore]);
  const totalAfter = sumValues([originTotalAfter, destinationTotalAfter]);

  const preview: TransferPreview = {
    basis: 'cost',
    quantity,
    avg_price: avgPrice,
    amount,
    origin: {
      portfolio_id: context.from_portfolio_id,
      quantity: {
        before: originBefore.position.quantity,
        after: originAfter.position.quantity,
      },
      avg_price: {
        before: originBefore.position.avg_price,
        after: originAfter.position.avg_price,
      },
      cost_basis: {
        before: originBefore.position.cost_basis,
        after: originAfter.position.cost_basis,
      },
      portfolio_cost_basis: { before: originTotalBefore, after: originTotalAfter },
    },
    destination: {
      portfolio_id: context.to_portfolio_id,
      quantity: {
        before: destinationBefore.position.quantity,
        after: destinationAfter.position.quantity,
      },
      avg_price: {
        before: destinationBefore.position.avg_price,
        after: destinationAfter.position.avg_price,
      },
      cost_basis: {
        before: destinationBefore.position.cost_basis,
        after: destinationAfter.position.cost_basis,
      },
      portfolio_cost_basis: {
        before: destinationTotalBefore,
        after: destinationTotalAfter,
      },
    },
    total: { before: totalBefore, after: totalAfter },
    // A transferência preserva o patrimônio total: esta diferença é zero, e o
    // teste de propriedade cobra isso para qualquer sequência.
    total_change: moneyDifference(totalAfter, totalBefore),
    available_quantity: originBefore.position.quantity,
    oversold: originAfter.oversold && !originBefore.oversold,
  };

  return {
    legs: [
      leg(context.from_portfolio_id, true, quantity, avgPrice, amount),
      leg(context.to_portfolio_id, false, quantity, avgPrice, amount),
    ],
    preview,
  };
};
