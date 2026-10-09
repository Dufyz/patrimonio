import {
  errorResponseSchema,
  getHealthCheckSchema,
  getLiveSchema,
  healthCheckResourceSchema,
  liveResourceSchema,
} from '@patrimonio/contracts';
import { z } from 'zod';
import type { ZodType } from 'zod';

import { ASSET_ROUTE_DOCS } from './asset.docs.js';
import { CATEGORY_ROUTE_DOCS } from './category.docs.js';
import { CORPORATE_EVENT_ROUTE_DOCS } from './corporate-event.docs.js';
import { MARKET_ROUTE_DOCS } from './market.docs.js';
import { TRANSACTION_ROUTE_DOCS } from './transaction.docs.js';
import { INSTITUTION_ROUTE_DOCS } from './institution.docs.js';
import { PORTFOLIO_ROUTE_DOCS } from './portfolio.docs.js';
import { POSITION_ROUTE_DOCS } from './position.docs.js';
import type { RouteDoc } from './route-doc.js';

export type { HttpMethod, ResponseDoc, RouteDoc } from './route-doc.js';

/**
 * O registro é composto por recurso: cada arquivo de `docs/` declara as rotas
 * daquele recurso, e um teste compara o que está montado no Express com o que
 * está aqui. Rota sem entrada não aparece em `/api/docs`.
 *
 * Cada resposta carrega a razão do código: um 503 sem explicação obriga quem lê
 * a abrir o controller.
 */
const HEALTH_ROUTE_DOCS: readonly RouteDoc[] = [
  {
    method: 'get',
    path: '/health-check/live',
    tag: 'Saúde',
    summary: 'O processo está de pé',
    request: getLiveSchema,
    responses: {
      200: {
        description: 'O processo responde. É o que o Traefik usa para decidir tráfego.',
        schema: liveResourceSchema,
      },
    },
  },
  {
    method: 'get',
    path: '/health-check',
    tag: 'Saúde',
    summary: 'Postgres, Redis e a data do último fechamento',
    request: getHealthCheckSchema,
    responses: {
      200: {
        description: 'As duas dependências respondem e o último fechamento é legível.',
        schema: healthCheckResourceSchema,
      },
      503: {
        description:
          'Postgres ou Redis não respondeu. A api pode estar de pé com os jobs parados.',
        schema: healthCheckResourceSchema,
      },
    },
  },
];

export const ROUTE_DOCS: readonly RouteDoc[] = [
  ...HEALTH_ROUTE_DOCS,
  ...PORTFOLIO_ROUTE_DOCS,
  ...INSTITUTION_ROUTE_DOCS,
  ...CATEGORY_ROUTE_DOCS,
  ...ASSET_ROUTE_DOCS,
  ...TRANSACTION_ROUTE_DOCS,
  ...CORPORATE_EVENT_ROUTE_DOCS,
  ...MARKET_ROUTE_DOCS,
  ...POSITION_ROUTE_DOCS,
];

type JsonSchema = Record<string, unknown>;

const toJson = (schema: ZodType, io: 'input' | 'output'): JsonSchema =>
  z.toJSONSchema(schema, { io, target: 'draft-2020-12' }) as JsonSchema;

/** `/health-check/{id}` no OpenAPI, `/health-check/:id` no Express. */
const toOpenApiPath = (path: string): string => path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');

const parametersFrom = (
  source: JsonSchema | undefined,
  location: 'query' | 'path',
): JsonSchema[] => {
  const properties = source?.['properties'] as Record<string, JsonSchema> | undefined;
  if (properties === undefined) return [];

  const required = (source?.['required'] as string[] | undefined) ?? [];

  return Object.entries(properties).map(([name, schema]) => ({
    name,
    in: location,
    required: location === 'path' ? true : required.includes(name),
    schema,
  }));
};

export const buildOpenApiDocument = (version: string): JsonSchema => {
  const paths: Record<string, Record<string, JsonSchema>> = {};

  for (const route of ROUTE_DOCS) {
    const request = toJson(route.request, 'input');
    const properties = request['properties'] as Record<string, JsonSchema> | undefined;

    const operation: JsonSchema = {
      tags: [route.tag],
      summary: route.summary,
      parameters: [
        ...parametersFrom(properties?.['params'], 'path'),
        ...parametersFrom(properties?.['query'], 'query'),
      ],
      responses: Object.fromEntries(
        Object.entries(route.responses).map(([status, response]) => [
          status,
          {
            description: response.description,
            ...(response.schema === undefined
              ? {}
              : {
                  content: {
                    'application/json': { schema: toJson(response.schema, 'output') },
                  },
                }),
          },
        ]),
      ),
    };

    const body = properties?.['body'];
    if (body !== undefined && route.method !== 'get') {
      operation['requestBody'] = {
        required: true,
        content: { 'application/json': { schema: body } },
      };
    }

    const key = `/api${toOpenApiPath(route.path)}`;
    paths[key] = { ...paths[key], [route.method]: operation };
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'Patrimônio',
      version,
      description:
        'Todas as rotas vivem sob /api. Valor monetário atravessa como string, ' +
        'nunca como número: NUMERIC(20,8) não cabe em double.',
    },
    servers: [{ url: '/' }],
    paths,
    components: {
      schemas: {
        ErrorResponse: toJson(errorResponseSchema, 'output'),
      },
    },
  };
};
