import { request } from './client.js';

/**
 * T-04 · As escritas que o extrato faz: excluir, desfazer e mover de carteira.
 *
 * Nenhuma é otimista. A linha só some da tela quando a `api` confirma, porque
 * excluir muda o preço médio de tudo o que veio depois e quem decide isso é o
 * recálculo, não o navegador. Toda escrita leva `Idempotency-Key`: o clique
 * duplo chega como o mesmo pedido, e não como dois.
 */

export type DeletionReceipt = {
  readonly undo: { readonly undo_id: string; readonly expires_at: string };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** O recibo da exclusão: só o que a tela usa, e erro nomeado se faltar. */
const receiptParser = {
  parse: (value: unknown): DeletionReceipt => {
    const undo = isRecord(value) ? value['undo'] : undefined;
    if (
      !isRecord(undo) ||
      typeof undo['undo_id'] !== 'string' ||
      typeof undo['expires_at'] !== 'string'
    ) {
      throw new Error('A api respondeu a exclusão fora do contrato');
    }
    return { undo: { undo_id: undo['undo_id'], expires_at: undo['expires_at'] } };
  },
};

const anyObject = { parse: (value: unknown): unknown => value };

const key = (): string => globalThis.crypto.randomUUID();

export const deleteTransaction = async (id: string): Promise<DeletionReceipt> =>
  request(`/api/transactions/${id}`, receiptParser, {
    method: 'DELETE',
    headers: { 'Idempotency-Key': key() },
  });

export const undoDeletion = async (undoId: string): Promise<void> => {
  await request(`/api/transactions/undo/${undoId}`, anyObject, {
    method: 'POST',
    headers: { 'Idempotency-Key': key() },
  });
};

export const moveTransaction = async (id: string, portfolioId: string): Promise<void> => {
  await request(`/api/transactions/${id}`, anyObject, {
    method: 'PATCH',
    headers: { 'Idempotency-Key': key() },
    body: JSON.stringify({ portfolio_id: portfolioId }),
  });
};
