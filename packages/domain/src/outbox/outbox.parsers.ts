import { isStage } from '../pipeline/pipeline.entities.js';
import type { Stage } from '../pipeline/pipeline.entities.js';
import type { OutboxEvent, OutboxPayloads } from './outbox.entities.js';

const asIsoString = (value: unknown): string => {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  throw new TypeError(`carimbo de tempo inválido: ${String(value)}`);
};

const asIsoStringOrNull = (value: unknown): string | null =>
  value === null || value === undefined ? null : asIsoString(value);

/**
 * Cópia campo a campo, de propósito: coluna nova no `SELECT *` não vaza para a
 * API sem alguém escrever a linha aqui.
 */
export const parseOutboxEventFromDB = (row: Record<string, unknown>): OutboxEvent => {
  if (!isStage(row['stage'])) {
    throw new TypeError(`estágio desconhecido na outbox: ${String(row['stage'])}`);
  }

  const stage: Stage = row['stage'];

  return {
    id: String(row['id']),
    stage,
    dedupe_key: String(row['dedupe_key']),
    payload: row['payload'] as OutboxPayloads[Stage],
    available_at: asIsoString(row['available_at']),
    debounce_until: asIsoStringOrNull(row['debounce_until']),
    dispatched_at: asIsoStringOrNull(row['dispatched_at']),
    started_at: asIsoStringOrNull(row['started_at']),
    completed_at: asIsoStringOrNull(row['completed_at']),
    failed_at: asIsoStringOrNull(row['failed_at']),
    attempts: Number(row['attempts'] ?? 0),
    error:
      row['error'] === null || row['error'] === undefined ? null : String(row['error']),
    origin_request_id:
      row['origin_request_id'] === null || row['origin_request_id'] === undefined
        ? null
        : String(row['origin_request_id']),
    created_at: asIsoString(row['created_at']),
  };
};
