import type {
  DebouncePolicy,
  EnqueuedEvent,
  OutboxRepository,
} from '@patrimonio/application';
import { parseOutboxEventFromDB } from '@patrimonio/domain';
import type { OutboxEvent, OutboxEventDraft, Stage } from '@patrimonio/domain';
import { failure, success } from '@patrimonio/shared';
import { v7 as uuidv7 } from 'uuid';

import { getRepositoryError } from '../errors/repository-error.js';
import type { Connection } from '../postgresql.js';

type Row = Record<string, unknown>;

export const createOutboxRepository = (
  sql: Connection,
  /**
   * A política de coalescência, quando há uma. Sem ela o evento é despachado na
   * primeira passada do relay, que é o comportamento certo para o que não chega em
   * rajada — fechamento, alertas e backup nascem de um agendamento.
   */
  debounce?: DebouncePolicy,
): OutboxRepository => ({
  /**
   * Uma consulta para N eventos. A coalescência é a restrição parcial de
   * unicidade sobre `dedupe_key` entre os pendentes: dois pedidos na mesma
   * rajada viram um, o `from_date` recua para a data mais antiga pedida, e a
   * espera é renovada até o teto calculado no primeiro pedido.
   */
  enqueue: async (events: readonly OutboxEventDraft[]) => {
    if (events.length === 0) return success([]);

    const rows = events
      .map((event) => debounce?.(event) ?? event)
      .map((event) => ({
        id: uuidv7(),
        stage: event.stage,
        dedupe_key: event.dedupe_key,
        payload: event.payload,
        available_at: (event.available_at ?? new Date()).toISOString(),
        debounce_until: event.debounce_until?.toISOString() ?? null,
        origin_request_id: event.origin_request_id ?? null,
      }));

    try {
      // Uma consulta para N eventos: a lista entra como um jsonb e volta
      // expandida em linhas. Laço de await com uma escrita por iteração não é
      // aceito em nenhum repositório.
      const inserted = await sql<{ id: string; dedupe_key: string; inserted: boolean }[]>`
        INSERT INTO pipeline_outbox
          (id, stage, dedupe_key, payload, available_at, debounce_until, origin_request_id)
        SELECT (entry ->> 'id')::UUID,
               (entry ->> 'stage')::pipeline_stage,
               entry ->> 'dedupe_key',
               entry -> 'payload',
               (entry ->> 'available_at')::TIMESTAMPTZ,
               (entry ->> 'debounce_until')::TIMESTAMPTZ,
               entry ->> 'origin_request_id'
          -- text antes de jsonb, não o cast direto: com o cast direto o driver
          -- infere o parâmetro como json e reencoda a string, que chega escalar.
          FROM JSONB_ARRAY_ELEMENTS(${JSON.stringify(rows)}::TEXT::JSONB) AS entry
        ON CONFLICT (dedupe_key) WHERE dispatched_at IS NULL AND failed_at IS NULL
        DO UPDATE SET
          payload = CASE
            WHEN pipeline_outbox.payload ? 'from_date' AND EXCLUDED.payload ? 'from_date'
              THEN JSONB_SET(
                EXCLUDED.payload,
                '{from_date}',
                TO_JSONB(LEAST(
                  pipeline_outbox.payload ->> 'from_date',
                  EXCLUDED.payload ->> 'from_date'
                ))
              )
            ELSE EXCLUDED.payload
          END,
          available_at = LEAST(
            GREATEST(EXCLUDED.available_at, pipeline_outbox.available_at),
            COALESCE(pipeline_outbox.debounce_until, EXCLUDED.available_at)
          )
        RETURNING id, dedupe_key, (xmax = 0) AS inserted
      `;

      const enqueued: EnqueuedEvent[] = inserted.map((row) => ({
        id: row.id,
        dedupe_key: row.dedupe_key,
        already_queued: !row.inserted,
      }));

      return success(enqueued);
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  /** `FOR UPDATE SKIP LOCKED`: dois relays não despacham o mesmo evento. */
  claimPending: async (limit: number) => {
    try {
      const rows = await sql<Row[]>`
        SELECT *
          FROM pipeline_outbox
         WHERE dispatched_at IS NULL
           AND failed_at IS NULL
           -- clock_timestamp, não now(): now() é o início da transação, e um
           -- evento gravado depois dela abrir nunca ficaria disponível.
           AND available_at <= CLOCK_TIMESTAMP()
         ORDER BY available_at, created_at
         LIMIT ${limit}
           FOR UPDATE skip locked
      `;

      return success(rows.map((row) => parseOutboxEventFromDB(row)));
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  markDispatched: async (ids: readonly string[]) => {
    if (ids.length === 0) return success(0);

    try {
      const updated = await sql<{ id: string }[]>`
        UPDATE pipeline_outbox
           SET dispatched_at = NOW()
         WHERE id = ANY(${sql.array([...ids])}::UUID[])
           AND dispatched_at IS NULL
        RETURNING id
      `;

      return success(updated.length);
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  markStarted: async (id: string) => {
    try {
      await sql`
        UPDATE pipeline_outbox
           SET started_at = NOW(),
               attempts = attempts + 1
         WHERE id = ${id}
      `;

      return success(undefined);
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  markCompleted: async (id: string) => {
    try {
      await sql`
        UPDATE pipeline_outbox
           SET completed_at = NOW(),
               error = NULL
         WHERE id = ${id}
      `;

      return success(undefined);
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  /**
   * Falha transitória registra a tentativa e deixa o BullMQ reexecutar; a
   * definitiva marca `failed_at`, e é ela que o painel Requer atenção lê.
   */
  markFailed: async (id: string, error: string, recoverable: boolean) => {
    try {
      await sql`
        UPDATE pipeline_outbox
           SET error = ${error},
               failed_at = CASE WHEN ${recoverable} THEN NULL ELSE NOW() END
         WHERE id = ${id}
      `;

      return success(undefined);
    } catch (caught) {
      return failure(getRepositoryError(caught));
    }
  },

  findById: async (id: string) => {
    try {
      const rows = await sql<Row[]>`SELECT * FROM pipeline_outbox WHERE id = ${id}`;
      const row = rows[0];

      return success(row === undefined ? null : parseOutboxEventFromDB(row));
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  /** A data do último fechamento concluído, que o healthcheck profundo reporta. */
  lastCompletedExecution: async (stage: Stage) => {
    try {
      const rows = await sql<
        { stage: string; completed_at: Date; reference_date: string | null }[]
      >`
        SELECT stage,
               completed_at,
               payload ->> 'reference_date' AS reference_date
          FROM pipeline_outbox
         WHERE stage = ${stage}
           AND completed_at IS NOT NULL
         ORDER BY completed_at DESC
         LIMIT 1
      `;

      const row = rows[0];
      if (row === undefined) return success(null);

      return success({
        stage,
        completed_at: row.completed_at.toISOString(),
        reference_date: row.reference_date,
      });
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },
});

export type { OutboxEvent };
