import type { LedgerEntry, Position } from '../../average_price/ledger.js';

/**
 * As sequências obrigatórias da estratégia de testes, com a saída conferida à mão
 * uma vez. Mudança no motor que troque um destes números falha o `pnpm test`, e é
 * o que diferencia um preço médio certo de um preço médio plausível.
 *
 * Todo caso real que aparecer na carteira e que o app errar entra aqui.
 */
export const buy = (
  trade_date: string,
  quantity: string,
  unit_price: string,
  fees = '0',
  id?: string,
): LedgerEntry => ({
  ...(id === undefined ? {} : { id }),
  kind: 'buy',
  trade_date,
  quantity,
  unit_price,
  fees,
  net_amount: `-${(Number(quantity) * Number(unit_price) + Number(fees)).toFixed(2)}`,
});

export const sell = (
  trade_date: string,
  quantity: string,
  unit_price: string,
  fees = '0',
  id?: string,
): LedgerEntry => ({
  ...(id === undefined ? {} : { id }),
  kind: 'sell',
  trade_date,
  quantity,
  unit_price,
  fees,
  net_amount: (Number(quantity) * Number(unit_price) - Number(fees)).toFixed(2),
});

export const corporateEvent = (
  trade_date: string,
  event_ratio_from: string,
  event_ratio_to: string,
): LedgerEntry => ({
  kind: 'corporate_event',
  trade_date,
  quantity: '0',
  unit_price: '0',
  fees: '0',
  net_amount: '0',
  event_ratio_from,
  event_ratio_to,
});

export type LedgerCase = {
  readonly name: string;
  readonly entries: readonly LedgerEntry[];
  readonly position: Position;
  readonly realized_total: string;
};

export const LEDGER_CASES: readonly LedgerCase[] = [
  {
    name: 'compra, compra, venda parcial e compra: a venda não altera o preço médio',
    entries: [
      buy('2024-01-10', '100', '30.00'),
      buy('2024-02-10', '100', '40.00'),
      sell('2024-03-10', '50', '50.00'),
      buy('2024-04-10', '50', '35.00'),
    ],
    position: {
      quantity: '200.00000000',
      avg_price: '35.00000000',
      cost_basis: '7000.00',
    },
    // 50 × 50 recebidos menos 50 × 35 de custo consumido.
    realized_total: '750.00',
  },
  {
    name: 'desdobramento 1:2 no meio da sequência mantém o custo total',
    entries: [
      buy('2024-01-10', '100', '30.00'),
      corporateEvent('2024-06-10', '1', '2'),
      buy('2024-07-10', '100', '15.00'),
    ],
    position: {
      quantity: '300.00000000',
      avg_price: '15.00000000',
      cost_basis: '4500.00',
    },
    realized_total: '0.00',
  },
  {
    name: 'grupamento 10:1 com quantidade ímpar trata a sobra como fração',
    entries: [buy('2024-01-10', '105', '10.00'), corporateEvent('2024-06-10', '10', '1')],
    position: {
      quantity: '10.50000000',
      avg_price: '100.00000000',
      cost_basis: '1050.00',
    },
    realized_total: '0.00',
  },
  {
    name: 'venda que zera e recompra depois: o preço médio recomeça do zero',
    entries: [
      buy('2024-01-10', '100', '30.00'),
      sell('2024-02-10', '100', '45.00'),
      buy('2024-03-10', '100', '20.00'),
    ],
    position: {
      quantity: '100.00000000',
      avg_price: '20.00000000',
      cost_basis: '2000.00',
    },
    realized_total: '1500.00',
  },
  {
    name: 'taxas entram no custo, e o preço unitário continua o da nota',
    entries: [buy('2024-01-10', '100', '30.00', '9.90')],
    position: {
      quantity: '100.00000000',
      avg_price: '30.09900000',
      cost_basis: '3009.90',
    },
    realized_total: '0.00',
  },
  {
    name: 'venda com taxa: o resultado é líquido da corretagem',
    entries: [
      buy('2024-01-10', '100', '30.00'),
      sell('2024-02-10', '40', '45.00', '4.90'),
    ],
    position: {
      quantity: '60.00000000',
      avg_price: '30.00000000',
      cost_basis: '1800.00',
    },
    // 40 × 45 − 4,90 = 1.795,10 recebidos; custo consumido 1.200.
    realized_total: '595.10',
  },
];
