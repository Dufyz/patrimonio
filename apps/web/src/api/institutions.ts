import { institutionResourceSchema } from '@patrimonio/contracts';
import type { InstitutionResource } from '@patrimonio/contracts';

import { request } from './client.js';
import type { Parser } from './client.js';

/** O catálogo de instituições vem da carga (`pnpm seed:institutions`). */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const listParser: Parser<readonly InstitutionResource[]> = {
  parse: (value) => {
    const items = isRecord(value) ? value['institutions'] : undefined;
    if (!Array.isArray(items))
      throw new Error('A api respondeu a lista fora do contrato');
    return items.map((item) => institutionResourceSchema.parse(item));
  },
};

export const fetchInstitutions = async (
  signal?: AbortSignal,
): Promise<readonly InstitutionResource[]> =>
  request('/api/institutions', listParser, signal === undefined ? {} : { signal });
