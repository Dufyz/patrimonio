import {
  allocationSchema,
  putStrategySchema,
} from '@patrimonio/contracts';
import type {
  AllocationResource,
  PutStrategyBody,
} from '@patrimonio/contracts';

import { request } from './client.js';

/**
 * T-06 · A estratégia: a leitura inteira da tela e a escrita do alvo.
 *
 * `GET /api/allocation` responde a tabela, o desvio, as regras e — com
 * `contribution` — a sugestão de aporte, todos sobre o mesmo fechamento. A
 * escrita é a que já existia, `PUT /portfolios/{id}/strategy`, e substitui o alvo
 * inteiro de uma vez: a soma só precisa valer no fim, e é por isso que trocar
 * 35/25/40 por 30/30/40 é possível.
 */
export type AllocationQuery = {
  /** A estratégia é de uma carteira. */
  readonly portfolioId: string;
  /** O valor do aporte a distribuir. Ausente é só a leitura. */
  readonly contribution?: string | undefined;
};

export const fetchAllocation = async (
  query: AllocationQuery,
  signal?: AbortSignal,
): Promise<AllocationResource> => {
  const search = new URLSearchParams({ portfolio_id: query.portfolioId });
  if (query.contribution !== undefined) search.set('contribution', query.contribution);

  return request(
    `/api/allocation?${search.toString()}`,
    allocationSchema,
    signal === undefined ? {} : { signal },
  );
};

const anyObject = { parse: (value: unknown): unknown => value };

const key = (): string => globalThis.crypto.randomUUID();

/**
 * Nenhuma escrita é otimista: a tela só mostra a estratégia nova depois que a
 * `api` confirma. O corpo é validado com o schema da própria `api` antes de sair,
 * e o erro do banco — soma que não fecha — volta com o texto dela.
 */
export const putStrategy = async (
  portfolioId: string,
  body: PutStrategyBody,
): Promise<void> => {
  const parsed = putStrategySchema.shape.body.parse(body);

  await request(`/api/portfolios/${portfolioId}/strategy`, anyObject, {
    method: 'PUT',
    headers: { 'Idempotency-Key': key() },
    body: JSON.stringify(parsed),
  });
};
