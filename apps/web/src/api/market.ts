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
};

const receiptParser = {
  parse: (value: unknown): RefreshReceipt => {
    const body = typeof value === 'object' && value !== null ? value : {};
    const jobId = (body as Record<string, unknown>)['job_id'];
    const queued = (body as Record<string, unknown>)['already_queued'];

    if (typeof jobId !== 'string' || typeof queued !== 'boolean') {
      throw new Error('A api respondeu o pedido de coleta fora do contrato');
    }

    return { job_id: jobId, already_queued: queued };
  },
};

/** Enfileira a coleta do dia e devolve na hora; a tela relê em seguida. */
export const refreshMarket = async (): Promise<RefreshReceipt> =>
  request('/api/market/refresh', receiptParser, {
    method: 'POST',
    body: JSON.stringify({}),
    headers: { 'Idempotency-Key': globalThis.crypto.randomUUID() },
  });
