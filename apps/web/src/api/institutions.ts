import { institutionResourceSchema } from '@patrimonio/contracts';
import type { InstitutionResource } from '@patrimonio/contracts';

import { request } from './client.js';
import type { Parser } from './client.js';

/**
 * O catálogo de instituições: as brasileiras vêm da carga (`pnpm seed:institutions`)
 * e as estrangeiras a pessoa cria na hora, ao lançar.
 */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const listParser: Parser<readonly InstitutionResource[]> = {
  parse: (value) => {
    const items = isRecord(value) ? value['institutions'] : undefined;
    if (!Array.isArray(items)) throw new Error('A api respondeu a lista fora do contrato');
    return items.map((item) => institutionResourceSchema.parse(item));
  },
};

const oneParser: Parser<InstitutionResource> = {
  parse: (value) =>
    institutionResourceSchema.parse(isRecord(value) ? value['institution'] : undefined),
};

export const fetchInstitutions = async (
  signal?: AbortSignal,
): Promise<readonly InstitutionResource[]> =>
  request('/api/institutions', listParser, signal === undefined ? {} : { signal });

export const createInstitution = async (
  body: { readonly name: string; readonly country: string },
  signal?: AbortSignal,
): Promise<InstitutionResource> =>
  request('/api/institutions', oneParser, {
    method: 'POST',
    body: JSON.stringify(body),
    ...(signal === undefined ? {} : { signal }),
  });
