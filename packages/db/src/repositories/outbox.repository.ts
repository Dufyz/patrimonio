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

    const rows = events.map((event) => debounce?.(event) ?? event).map((event) => ({
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
        insert into pipeline_outbox
          (id, stage, dedupe_key, payload, available_at, debounce_until, origin_request_id)
        select (entry ->> 'id')::uuid,
               (entry ->> 'stage')::pipeline_stage,
               entry ->> 'dedupe_key',
               entry -> 'payload',
               (entry ->> 'available_at')::timestamptz,
               (entry ->> 'debounce_until')::timestamptz,
               entry ->> 'origin_request_id'
          -- text antes de jsonb, não o cast direto: com o cast direto o driver
          -- infere o parâmetro como json e reencoda a string, que chega escalar.
          from jsonb_array_elements(${JSON.stringify(rows)}::text::jsonb) as entry
        on conflict (dedupe_key) where dispatched_at is null and failed_at is null
        do update set
          payload = case
            when pipeline_outbox.payload ? 'from_date' and excluded.payload ? 'from_date'
              then jsonb_set(
                excluded.payload,
                '{from_date}',
                to_jsonb(least(
                  pipeline_outbox.payload ->> 'from_date',
                  excluded.payload ->> 'from_date'
                ))
              )
            else excluded.payload
          end,
          available_at = least(
            greatest(excluded.available_at, pipeline_outbox.available_at),
            coalesce(pipeline_outbox.debounce_until, excluded.available_at)
          )
        returning id, dedupe_key, (xmax = 0) as inserted
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
        select *
          from pipeline_outbox
         where dispatched_at is null
           and failed_at is null
           -- clock_timestamp, não now(): now() é o início da transação, e um
           -- evento gravado depois dela abrir nunca ficaria disponível.
           and available_at <= clock_timestamp()
         order by available_at, created_at
         limit ${limit}
           for update skip locked
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
        update pipeline_outbox
           set dispatched_at = now()
         where id = any(${sql.array([...ids])}::uuid[])
           and dispatched_at is null
        returning id
      `;

      return success(updated.length);
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  markStarted: async (id: string) => {
    try {
      await sql`
        update pipeline_outbox
           set started_at = now(),
               attempts = attempts + 1
         where id = ${id}
      `;

      return success(undefined);
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  markCompleted: async (id: string) => {
    try {
      await sql`
        update pipeline_outbox
           set completed_at = now(),
               error = null
         where id = ${id}
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
        update pipeline_outbox
           set error = ${error},
               failed_at = case when ${recoverable} then null else now() end
         where id = ${id}
      `;

      return success(undefined);
    } catch (caught) {
      return failure(getRepositoryError(caught));
    }
  },

  findById: async (id: string) => {
    try {
      const rows = await sql<Row[]>`select * from pipeline_outbox where id = ${id}`;
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
        select stage,
               completed_at,
               payload ->> 'reference_date' as reference_date
          from pipeline_outbox
         where stage = ${stage}
           and completed_at is not null
         order by completed_at desc
         limit 1
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
