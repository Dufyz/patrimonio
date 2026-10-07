import type { DateOnly } from '../support/date_only.js';
import type { Stage } from '../pipeline/pipeline.entities.js';

/**
 * O próximo trabalho é um evento aqui, gravado na mesma transação do estado que
 * o origina. Nenhum caso de uso chama `Queue.add`: o BullMQ é o transporte, o
 * Postgres é a fonte da verdade.
 */
export type OutboxPayloads = {
  readonly recalc: { readonly portfolio_id: string; readonly from_date: DateOnly };
  readonly market: { readonly reference_date: DateOnly; readonly asset_id?: string };
  readonly close: { readonly reference_date: DateOnly };
  readonly alerts: { readonly reference_date: DateOnly };
  readonly import: { readonly import_id: string };
  readonly backup: { readonly reference_date: DateOnly };
};

export type OutboxPayload<S extends Stage = Stage> = OutboxPayloads[S];

export type OutboxEvent<S extends Stage = Stage> = {
  /** UUID v7. É também o `jobId` no BullMQ, o que torna o despacho idempotente. */
  readonly id: string;
  readonly stage: S;
  readonly dedupe_key: string;
  readonly payload: OutboxPayloads[S];
  /** Atraso: o relay só despacha a partir daqui. */
  readonly available_at: string;
  /** Teto da espera renovada, contado do primeiro pedido da rajada. */
  readonly debounce_until: string | null;
  readonly dispatched_at: string | null;
  /**
   * O histórico de execução fica no Postgres, não no Redis: um `FLUSHALL` não
   * apaga a resposta para "quando foi o último fechamento".
   */
  readonly started_at: string | null;
  readonly completed_at: string | null;
  readonly failed_at: string | null;
  readonly attempts: number;
  readonly error: string | null;
  /** O requestId que originou o pedido, para ligar o clique ao job. */
  readonly origin_request_id: string | null;
  readonly created_at: string;
};

/** O que um plano devolve: o evento antes de existir no banco. */
export type OutboxEventDraft<S extends Stage = Stage> = {
  readonly stage: S;
  readonly dedupe_key: string;
  readonly payload: OutboxPayloads[S];
  readonly available_at?: Date;
  readonly debounce_until?: Date;
  readonly origin_request_id?: string;
};

/**
 * Coalescência é a chave: dois eventos pendentes com a mesma chave são um só.
 * Lançar cinco operações seguidas na mesma carteira produz um recálculo, não
 * cinco — e por isso a chave do recálculo não carrega a data: o `from_date`
 * mora no payload e recua para a data mais antiga pedida na rajada.
 */
export const dedupeKey = {
  recalc: (portfolioId: string): string => `recalc:${portfolioId}`,
  backfill: (assetId: string): string => `backfill:${assetId}`,
  market: (date: DateOnly): string => `market:${date}`,
  close: (date: DateOnly): string => `close:${date}`,
  alerts: (date: DateOnly): string => `alerts:${date}`,
  import: (importId: string): string => `import:${importId}`,
  backup: (date: DateOnly): string => `backup:${date}`,
} as const;
