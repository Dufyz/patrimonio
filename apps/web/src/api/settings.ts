import { settingsSchema } from '@patrimonio/contracts';
import type { Settings } from '@patrimonio/contracts';
import { request } from './client.js';

/**
 * T-08 · A tela de Configurações, em duas chamadas.
 *
 * `GET /api/settings` entrega as seções de cadastro — carteiras, alertas,
 * categorias, instituições, benchmarks, padrões de lançamento e backup — de uma
 * vez. Os dados de mercado têm a rota deles (`api/market.ts`), porque mudam por
 * conta própria enquanto uma coleta roda e precisam de releitura própria.
 */
export const fetchSettings = async (signal?: AbortSignal): Promise<Settings> =>
  request('/api/settings', settingsSchema, signal === undefined ? {} : { signal });

export type BackupReceipt = {
  readonly job_id: string;
  readonly already_queued: boolean;
};

/**
 * O recibo, lido à mão: o `web` não depende de `zod`, e só duas chaves importam.
 * Resposta fora do formato vira erro nomeado, em vez de um "pedido" sem número.
 */
const receiptParser = {
  parse: (value: unknown): BackupReceipt => {
    const body = typeof value === 'object' && value !== null ? value : {};
    const jobId = (body as Record<string, unknown>)['job_id'];
    const queued = (body as Record<string, unknown>)['already_queued'];

    if (typeof jobId !== 'string' || typeof queued !== 'boolean') {
      throw new Error('A api respondeu o pedido de backup fora do contrato');
    }

    return { job_id: jobId, already_queued: queued };
  },
};

/**
 * "Fazer backup agora". A `api` enfileira e responde 202: o dump leva o tempo do
 * banco, e a tela só diz que foi pedido. Leva `Idempotency-Key`, para o clique
 * duplo chegar como o mesmo pedido.
 */
export const runBackup = async (): Promise<BackupReceipt> =>
  request('/api/backup', receiptParser, {
    method: 'POST',
    body: JSON.stringify({}),
    headers: { 'Idempotency-Key': globalThis.crypto.randomUUID() },
  });
