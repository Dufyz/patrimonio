import { transferCustodyResponseSchema } from '@patrimonio/contracts';
import type { TransferCustodyBody, TransferCustodyResponse } from '@patrimonio/contracts';
import { request } from './client.js';
import type { Parser } from './client.js';

/**
 * A troca de custodiante de um ativo. A origem não é enviada: é a custódia
 * atual, que a `api` lê do livro — a tela mostrar uma origem e a `api` usar
 * outra seria a transferência gravada de onde o papel não está.
 */
const base = (portfolioId: string, assetId: string): string =>
  `/api/portfolios/${portfolioId}/assets/${assetId}/custody-transfers`;

export const transferCustody = async (
  portfolioId: string,
  assetId: string,
  body: TransferCustodyBody,
): Promise<TransferCustodyResponse> =>
  request(base(portfolioId, assetId), transferCustodyResponseSchema, {
    method: 'POST',
    body: JSON.stringify(body),
  });

/** A resposta do desfazer é só a mensagem; o que importa é ter dado certo. */
const acknowledged: Parser<unknown> = { parse: (value) => value };

export const undoCustodyTransfer = async (
  portfolioId: string,
  assetId: string,
  transferId: string,
): Promise<void> => {
  await request(`${base(portfolioId, assetId)}/${transferId}`, acknowledged, {
    method: 'DELETE',
  });
};
