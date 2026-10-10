import type {
  TransactionFilter,
  TransactionPatch,
  TransactionRepository,
  TransactionWrite,
} from '@patrimonio/application';
import { parseTransactionFromDB } from '@patrimonio/domain';
import { failure, success } from '@patrimonio/shared';
import { v7 as uuidv7 } from 'uuid';

import { getRepositoryError } from '../errors/repository-error.js';
import type { Connection } from '../postgresql.js';
import { definedColumns, hasChanges } from '../support/changes.js';

type Row = Record<string, unknown>;

export const createTransactionRepository = (sql: Connection): TransactionRepository => ({
  nextId: () => uuidv7(),

  findById: async (id: string) => {
    try {
      const rows = await sql<Row[]>`SELECT * FROM transaction WHERE id = ${id}`;
      const row = rows[0];

      return success(row === undefined ? null : parseTransactionFromDB(row));
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  findByIdempotencyKey: async (key: string) => {
    try {
      const rows = await sql<Row[]>`
        SELECT * FROM transaction WHERE idempotency_key = ${key} LIMIT 1
      `;
      const row = rows[0];

      return success(row === undefined ? null : parseTransactionFromDB(row));
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  expireIdempotencyKeys: async (olderThanHours: number) => {
    try {
      const rows = await sql<{ id: string }[]>`
        UPDATE transaction
           SET idempotency_key = NULL
         WHERE idempotency_key IS NOT NULL
           AND created_at < NOW() - MAKE_INTERVAL(hours => ${olderThanHours})
        RETURNING id
      `;

      return success(rows.length);
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  /**
   * O extrato de Movimentações, com os filtros combináveis. Duas consultas: a
   * página e a contagem — o orçamento da rota conta as duas.
   */
  list: async (filter: TransactionFilter) => {
    const offset = (filter.page - 1) * filter.limit;

    const where = sql`
      WHERE ${filter.portfolio_id === undefined ? sql`TRUE` : sql`portfolio_id = ${filter.portfolio_id}`}
        AND ${filter.asset_id === undefined ? sql`TRUE` : sql`asset_id = ${filter.asset_id}`}
        AND ${
          filter.institution_id === undefined
            ? sql`TRUE`
            : sql`institution_id = ${filter.institution_id}`
        }
        AND ${filter.kind === undefined ? sql`TRUE` : sql`kind = ${filter.kind}`}
        AND ${filter.from === undefined ? sql`TRUE` : sql`trade_date >= ${filter.from}`}
        AND ${filter.to === undefined ? sql`TRUE` : sql`trade_date <= ${filter.to}`}
        AND ${
          filter.pending_payouts === true
            ? sql`kind = 'payout' AND confirmed_at IS NULL`
            : sql`TRUE`
        }
    `;

    try {
      const rows = await sql<Row[]>`
        SELECT * FROM transaction ${where}
         ORDER BY trade_date DESC, created_at DESC
         LIMIT ${filter.limit} OFFSET ${offset}
      `;

      const counted = await sql<{ total: string }[]>`
        SELECT COUNT(*)::TEXT AS total FROM transaction ${where}
      `;

      return success({
        data: rows.map((row) => parseTransactionFromDB(row)),
        total: Number(counted[0]?.total ?? 0),
      });
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  /**
   * Uma consulta para N linhas. A lista entra como jsonb e volta expandida: laço
   * de `await` com uma escrita por iteração não é aceito em repositório nenhum.
   */
  insertMany: async (rows: readonly TransactionWrite[]) => {
    if (rows.length === 0) return success([]);

    const payload = JSON.stringify(
      rows.map((row) => ({
        id: row.id ?? uuidv7(),
        kind: row.kind,
        trade_date: row.trade_date,
        settlement_date: row.settlement_date,
        portfolio_id: row.portfolio_id,
        asset_id: row.asset_id ?? null,
        institution_id: row.institution_id,
        quantity: row.quantity,
        unit_price: row.unit_price,
        fees: row.fees,
        gross_amount: row.gross_amount,
        tax_withheld: row.tax_withheld ?? '0',
        net_amount: row.net_amount,
        payout_kind: row.payout_kind ?? null,
        expected_net_amount: row.expected_net_amount ?? null,
        record_date: row.record_date ?? null,
        confirmed_at: row.confirmed_at ?? null,
        event_ratio_from: row.event_ratio_from ?? null,
        event_ratio_to: row.event_ratio_to ?? null,
        note: row.note ?? null,
        idempotency_key: row.idempotency_key ?? null,
      })),
    );

    try {
      const inserted = await sql<Row[]>`
        INSERT INTO transaction
          (id, kind, trade_date, settlement_date, portfolio_id, asset_id, institution_id,
           quantity, unit_price, fees, gross_amount, tax_withheld, net_amount,
           payout_kind, expected_net_amount, record_date, confirmed_at,
           event_ratio_from, event_ratio_to, note, idempotency_key)
        SELECT (entry ->> 'id')::UUID,
               (entry ->> 'kind')::transaction_kind,
               (entry ->> 'trade_date')::DATE,
               (entry ->> 'settlement_date')::DATE,
               (entry ->> 'portfolio_id')::UUID,
               (entry ->> 'asset_id')::UUID,
               (entry ->> 'institution_id')::UUID,
               (entry ->> 'quantity')::NUMERIC,
               (entry ->> 'unit_price')::NUMERIC,
               (entry ->> 'fees')::NUMERIC,
               (entry ->> 'gross_amount')::NUMERIC,
               (entry ->> 'tax_withheld')::NUMERIC,
               (entry ->> 'net_amount')::NUMERIC,
               (entry ->> 'payout_kind')::payout_kind,
               (entry ->> 'expected_net_amount')::NUMERIC,
               (entry ->> 'record_date')::DATE,
               (entry ->> 'confirmed_at')::TIMESTAMPTZ,
               (entry ->> 'event_ratio_from')::NUMERIC,
               (entry ->> 'event_ratio_to')::NUMERIC,
               entry ->> 'note',
               entry ->> 'idempotency_key'
          -- text antes de jsonb: com o cast direto o driver infere o parâmetro
          -- como json e reencoda a string, que chega escalar.
          FROM JSONB_ARRAY_ELEMENTS(${payload}::TEXT::JSONB) AS entry
        RETURNING *
      `;

      return success(inserted.map((row) => parseTransactionFromDB(row)));
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  update: async (id: string, patch: TransactionPatch) => {
    const changes = definedColumns({ ...patch });

    try {
      const rows = hasChanges(changes)
        ? await sql<Row[]>`
            UPDATE transaction SET ${sql(changes)} WHERE id = ${id} RETURNING *
          `
        : await sql<Row[]>`SELECT * FROM transaction WHERE id = ${id}`;
      const row = rows[0];

      return success(row === undefined ? null : parseTransactionFromDB(row));
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  remove: async (id: string) => {
    try {
      const rows = await sql<Row[]>`DELETE FROM transaction WHERE id = ${id} RETURNING *`;
      const row = rows[0];

      return success(row === undefined ? null : parseTransactionFromDB(row));
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },
});
