import type {
  InstitutionDraft,
  InstitutionRepository,
  InstitutionWrite,
} from '@patrimonio/application';
import { parseInstitutionFromDB } from '@patrimonio/domain';
import { failure, success } from '@patrimonio/shared';
import { v7 as uuidv7 } from 'uuid';

import { getRepositoryError } from '../errors/repository-error.js';
import type { Connection } from '../postgresql.js';
import { definedColumns, hasChanges } from '../support/changes.js';

type Row = Record<string, unknown>;

export const createInstitutionRepository = (sql: Connection): InstitutionRepository => ({
  findById: async (id: string) => {
    try {
      const rows = await sql<Row[]>`select * from institution where id = ${id}`;
      const row = rows[0];

      return success(row === undefined ? null : parseInstitutionFromDB(row));
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  findByName: async (name: string) => {
    try {
      const rows = await sql<Row[]>`
        select * from institution where lower(name) = lower(${name}) limit 1
      `;
      const row = rows[0];

      return success(row === undefined ? null : parseInstitutionFromDB(row));
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  list: async () => {
    try {
      const rows = await sql<Row[]>`select * from institution order by lower(name)`;

      return success(rows.map((row) => parseInstitutionFromDB(row)));
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  create: async (draft: InstitutionDraft) => {
    const row = definedColumns({
      id: uuidv7(),
      name: draft.name,
      role: draft.role,
      fgc_covered: draft.fgc_covered,
      brokerage_per_order: draft.brokerage_per_order,
      custody_monthly_fee: draft.custody_monthly_fee,
    });

    try {
      const rows = await sql<Row[]>`insert into institution ${sql(row)} returning *`;
      const created = rows[0];

      if (created === undefined) {
        return failure(
          getRepositoryError(new Error('insert de instituição sem retorno')),
        );
      }

      return success(parseInstitutionFromDB(created));
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  update: async (id: string, patch: InstitutionWrite) => {
    const changes = definedColumns({ ...patch });

    try {
      const rows = hasChanges(changes)
        ? await sql<Row[]>`
            update institution set ${sql(changes)} where id = ${id} returning *
          `
        : await sql<Row[]>`select * from institution where id = ${id}`;
      const row = rows[0];

      return success(row === undefined ? null : parseInstitutionFromDB(row));
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  remove: async (id: string) => {
    try {
      const rows = await sql<{ id: string }[]>`
        delete from institution where id = ${id} returning id
      `;

      return success(rows.length > 0);
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  /** O que impede a exclusão, contado numa consulta só. */
  usage: async (id: string) => {
    try {
      const rows = await sql<{ transactions: string; assets: string }[]>`
        select (select count(*) from transaction where institution_id = ${id})::text
                 as transactions,
               (select count(*) from asset where issuer_id = ${id})::text as assets
      `;
      const row = rows[0];

      return success({
        transactions: Number(row?.transactions ?? 0),
        assets: Number(row?.assets ?? 0),
      });
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  /**
   * Aplicado menos resgatado nos títulos deste emissor. Sai do livro, e não de
   * `position_daily`: a projeção ainda não existe em E2, e o custo é o número
   * honesto até a marcação na curva entrar.
   */
  issuerExposure: async (id: string) => {
    try {
      const rows = await sql<{ exposure: string; assets: string }[]>`
        select coalesce(sum(
                 case t.kind
                   when 'buy'  then t.gross_amount
                   when 'sell' then -t.gross_amount
                   else 0
                 end
               ), 0)::text as exposure,
               count(distinct a.id)::text as assets
          from asset a
          join transaction t on t.asset_id = a.id
         where a.issuer_id = ${id}
           and a.origin = 'manual'
      `;
      const row = rows[0];

      return success({
        exposure_brl: row?.exposure ?? '0',
        assets: Number(row?.assets ?? 0),
      });
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },
});
