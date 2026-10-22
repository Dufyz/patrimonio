import { marketHealthSchema } from '@patrimonio/contracts';
import type { MarketHealth } from '@patrimonio/contracts';
import { request } from './client.js';

/**
 * M-16 · A situação dos dados de mercado, e o "atualizar agora".
 *
 * A leitura é a mesma que responde "o número da tela é de hoje?" — por fonte, a
 * situação, o horário da última coleta e a cobertura; a falha vem com a
 * mensagem do erro, e não com um código.
 */
export const fetchMarketHealth = async (signal?: AbortSignal): Promise<MarketHealth> =>
  request(
    '/api/market/health',
    marketHealthSchema,
    signal === undefined ? {} : { signal },
  );

export type RefreshReceipt = {
  readonly job_id: string;
  readonly already_queued: boolean;
  /** O instante do clique, segundo o servidor: o lote da atualização. */
  readonly requested_at: string;
};

const receiptParser = {
  parse: (value: unknown): RefreshReceipt => {
    const body = typeof value === 'object' && value !== null ? value : {};
    const jobId = (body as Record<string, unknown>)['job_id'];
    const queued = (body as Record<string, unknown>)['already_queued'];
    const requestedAt = (body as Record<string, unknown>)['requested_at'];

    if (
      typeof jobId !== 'string' ||
      typeof queued !== 'boolean' ||
      typeof requestedAt !== 'string' ||
      Number.isNaN(Date.parse(requestedAt))
    ) {
      throw new Error('A api respondeu o pedido de coleta fora do contrato');
    }

    return { job_id: jobId, already_queued: queued, requested_at: requestedAt };
  },
};

/**
 * "Atualizar agora": enfileira o reset completo e devolve na hora; a tela relê
 * em seguida até uma coleta posterior ao clique aparecer.
 */
export const refreshMarket = async (): Promise<RefreshReceipt> =>
  request('/api/market/refresh', receiptParser, {
    method: 'POST',
    body: JSON.stringify({}),
    headers: { 'Idempotency-Key': globalThis.crypto.randomUUID() },
  });
