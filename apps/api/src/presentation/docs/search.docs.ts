import {
  errorResponseSchema,
  getSearchSchema,
  searchResourceSchema,
} from '@patrimonio/contracts';

import type { RouteDoc } from './route-doc.js';

export const SEARCH_ROUTE_DOCS: readonly RouteDoc[] = [
  {
    method: 'get',
    path: '/search',
    tag: 'Busca',
    summary: 'A busca global: ativos e lançamentos que casam com o texto',
    request: getSearchSchema,
    responses: {
      200: {
        description:
          'Os ativos e os lançamentos que casam com o texto, cada grupo já na ' +
          'ordem em que deve aparecer e limitado a `limit` itens, com o total ' +
          'de cada grupo contado no banco. Entre ativos, o código exato vem ' +
          'primeiro e, empatados no texto, vem antes o que a pessoa tem em ' +
          'carteira. A posição é a do último dia de cada carteira ativa, ' +
          'somada, e é nula para o ativo só cadastrado. Telas, carteiras e ' +
          'ações não passam por aqui: o navegador as tem.',
        schema: searchResourceSchema,
      },
      400: {
        description:
          'Texto vazio ou com mais de 80 caracteres, identificador que não é ' +
          'um UUID, ou limite fora de 1 a 10.',
        schema: errorResponseSchema,
      },
    },
  },
];
