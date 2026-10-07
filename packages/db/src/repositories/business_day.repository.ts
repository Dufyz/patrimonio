import type { BusinessDayRepository } from '@patrimonio/application';
import { parseBusinessDayFromDB } from '@patrimonio/domain';
import type { DateOnly } from '@patrimonio/domain';
import { failure, success } from '@patrimonio/shared';

import { getRepositoryError } from '../errors/repository-error.js';
import type { Connection } from '../postgresql.js';

type Row = Record<string, unknown>;

export const createBusinessDayRepository = (sql: Connection): BusinessDayRepository => ({
  listBetween: async (from: DateOnly, to: DateOnly) => {
    try {
      const rows = await sql<Row[]>`
        select *
          from business_day
         where calendar_date between ${from} and ${to}
         order by calendar_date
      `;

      return success(rows.map((row) => parseBusinessDayFromDB(row)));
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  countBetween: async (from: DateOnly, to: DateOnly) => {
    try {
      const rows = await sql<{ total: string }[]>`
        select count(*)::text as total
          from business_day
         where calendar_date between ${from} and ${to}
           and is_business_day
      `;

      return success(Number(rows[0]?.total ?? 0));
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  isBusinessDay: async (date: DateOnly) => {
    try {
      const rows = await sql<{ is_business_day: boolean }[]>`
        select is_business_day from business_day where calendar_date = ${date}
      `;

      // Fora do calendário carregado a resposta é "não sei", e chutar aqui
      // produziria juro corrido errado em silêncio.
      const row = rows[0];
      if (row === undefined) {
        return failure(
          getRepositoryError(new Error(`data fora do calendário carregado: ${date}`)),
        );
      }

      return success(row.is_business_day);
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  nextBusinessDay: async (date: DateOnly) => {
    try {
      const rows = await sql<{ calendar_date: string }[]>`
        select calendar_date
          from business_day
         where calendar_date > ${date}
           and is_business_day
         order by calendar_date
         limit 1
      `;

      return success(rows[0]?.calendar_date ?? null);
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  previousBusinessDay: async (date: DateOnly) => {
    try {
      const rows = await sql<{ calendar_date: string }[]>`
        select calendar_date
          from business_day
         where calendar_date < ${date}
           and is_business_day
         order by calendar_date desc
         limit 1
      `;

      return success(rows[0]?.calendar_date ?? null);
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },
});
