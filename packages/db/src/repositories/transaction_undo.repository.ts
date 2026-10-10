import type {
  TransactionUndo,
  TransactionUndoDraft,
  TransactionUndoRepository,
} from '@patrimonio/application';
import {
  asDateOnly,
  asIsoString,
  asString,
  parseTransactionFromDB,
} from '@patrimonio/domain';
import type { Row } from '@patrimonio/domain';
import { failure, success } from '@patrimonio/shared';
import { v7 as uuidv7 } from 'uuid';

import { getRepositoryError } from '../errors/repository-error.js';
import type { Connection } from '../postgresql.js';

const parseUndoFromDB = (row: Row): TransactionUndo => {
  const payload = row['payload'];
  const rows = (typeof payload === 'string' ? JSON.parse(payload) : payload) as Row[];

  return {
    id: asString(row, 'id'),
    transaction_id: asString(row, 'transaction_id'),
    portfolio_id: asString(row, 'portfolio_id'),
    transactions: rows.map((entry) => parseTransactionFromDB(entry)),
    from_date: asDateOnly(row, 'from_date'),
    expires_at: asIsoString(row, 'expires_at'),
    created_at: asIsoString(row, 'created_at'),
  };
};

export const createTransactionUndoRepository = (
  sql: Connection,
): TransactionUndoRepository => ({
  create: async (draft: TransactionUndoDraft) => {
    try {
      const rows = await sql<Row[]>`
        INSERT INTO transaction_undo
          (id, transaction_id, portfolio_id, payload, from_date, expires_at)
        VALUES (${uuidv7()}, ${draft.transaction_id}, ${draft.portfolio_id},
                ${JSON.stringify(draft.transactions)}::TEXT::JSONB,
                ${draft.from_date}, ${draft.expires_at})
        RETURNING *
      `;

      const created = rows[0];
      if (created === undefined) {
        return failure(getRepositoryError(new Error('insert de desfazer sem retorno')));
      }

      return success(parseUndoFromDB(created));
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  findById: async (id: string) => {
    try {
      const rows = await sql<Row[]>`SELECT * FROM transaction_undo WHERE id = ${id}`;
      const row = rows[0];

      return success(row === undefined ? null : parseUndoFromDB(row));
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  remove: async (id: string) => {
    try {
      const rows = await sql<{ id: string }[]>`
        DELETE FROM transaction_undo WHERE id = ${id} RETURNING id
      `;

      return success(rows.length > 0);
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },
});
