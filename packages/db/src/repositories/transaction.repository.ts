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
      const rows = await sql<Row[]>`select * from transaction where id = ${id}`;
      const row = rows[0];

      return success(row === undefined ? null : parseTransactionFromDB(row));
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  findByIdempotencyKey: async (key: string) => {
    try {
      const rows = await sql<Row[]>`
        select * from transaction where idempotency_key = ${key} limit 1
      `;
      const row = rows[0];

      return success(row === undefined ? null : parseTransactionFromDB(row));
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
      where ${filter.portfolio_id === undefined ? sql`true` : sql`portfolio_id = ${filter.portfolio_id}`}
        and ${filter.asset_id === undefined ? sql`true` : sql`asset_id = ${filter.asset_id}`}
        and ${
          filter.institution_id === undefined
            ? sql`true`
            : sql`institution_id = ${filter.institution_id}`
        }
        and ${filter.kind === undefined ? sql`true` : sql`kind = ${filter.kind}`}
        and ${filter.from === undefined ? sql`true` : sql`trade_date >= ${filter.from}`}
        and ${filter.to === undefined ? sql`true` : sql`trade_date <= ${filter.to}`}
        and ${
          filter.pending_payouts === true
            ? sql`kind = 'payout' and confirmed_at is null`
            : sql`true`
        }
    `;

    try {
      const rows = await sql<Row[]>`
        select * from transaction ${where}
         order by trade_date desc, created_at desc
         limit ${filter.limit} offset ${offset}
      `;

      const counted = await sql<{ total: string }[]>`
        select count(*)::text as total from transaction ${where}
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
   * Uma consulta para N linhas. A lista entra como jsonb e volta expandida: as
   * duas pernas de uma transferência precisam nascer na mesma escrita, e laço
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
        transfer_group_id: row.transfer_group_id ?? null,
        event_ratio_from: row.event_ratio_from ?? null,
        event_ratio_to: row.event_ratio_to ?? null,
        note: row.note ?? null,
        idempotency_key: row.idempotency_key ?? null,
      })),
    );

    try {
      const inserted = await sql<Row[]>`
        insert into transaction
          (id, kind, trade_date, settlement_date, portfolio_id, asset_id, institution_id,
           quantity, unit_price, fees, gross_amount, tax_withheld, net_amount,
           payout_kind, expected_net_amount, record_date, confirmed_at,
           transfer_group_id, event_ratio_from, event_ratio_to, note, idempotency_key)
        select (entry ->> 'id')::uuid,
               (entry ->> 'kind')::transaction_kind,
               (entry ->> 'trade_date')::date,
               (entry ->> 'settlement_date')::date,
               (entry ->> 'portfolio_id')::uuid,
               (entry ->> 'asset_id')::uuid,
               (entry ->> 'institution_id')::uuid,
               (entry ->> 'quantity')::numeric,
               (entry ->> 'unit_price')::numeric,
               (entry ->> 'fees')::numeric,
               (entry ->> 'gross_amount')::numeric,
               (entry ->> 'tax_withheld')::numeric,
               (entry ->> 'net_amount')::numeric,
               (entry ->> 'payout_kind')::payout_kind,
               (entry ->> 'expected_net_amount')::numeric,
               (entry ->> 'record_date')::date,
               (entry ->> 'confirmed_at')::timestamptz,
               (entry ->> 'transfer_group_id')::uuid,
               (entry ->> 'event_ratio_from')::numeric,
               (entry ->> 'event_ratio_to')::numeric,
               entry ->> 'note',
               entry ->> 'idempotency_key'
          -- text antes de jsonb: com o cast direto o driver infere o parâmetro
          -- como json e reencoda a string, que chega escalar.
          from jsonb_array_elements(${payload}::text::jsonb) as entry
        returning *
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
            update transaction set ${sql(changes)} where id = ${id} returning *
          `
        : await sql<Row[]>`select * from transaction where id = ${id}`;
      const row = rows[0];

      return success(row === undefined ? null : parseTransactionFromDB(row));
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  remove: async (id: string) => {
    try {
      const rows = await sql<Row[]>`delete from transaction where id = ${id} returning *`;
      const row = rows[0];

      return success(row === undefined ? null : parseTransactionFromDB(row));
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  removeByTransferGroup: async (groupId: string) => {
    try {
      const rows = await sql<Row[]>`
        delete from transaction where transfer_group_id = ${groupId} returning *
      `;

      return success(rows.map((row) => parseTransactionFromDB(row)));
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  findByTransferGroup: async (groupId: string) => {
    try {
      const rows = await sql<Row[]>`
        select * from transaction where transfer_group_id = ${groupId} order by net_amount
      `;

      return success(rows.map((row) => parseTransactionFromDB(row)));
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },
});
