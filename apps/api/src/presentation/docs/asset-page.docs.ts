import {
  assetPageResourceSchema,
  errorResponseSchema,
  getAssetPageSchema,
} from '@patrimonio/contracts';

import type { RouteDoc } from './route-doc.js';

const TAG = 'Ativos';

export const ASSET_PAGE_ROUTE_DOCS: readonly RouteDoc[] = [
  {
    method: 'get',
    path: '/assets/:asset_id/page',
    tag: TAG,
    summary: 'Tudo sobre um ativo, para a página dele',
    request: getAssetPageSchema,
    responses: {
      200: {
        description:
          'Posição, preço, série do gráfico com as marcas de compra e venda, ' +
          'proventos por mês, lançamentos, cadastro e eventos corporativos, no ' +
          'recorte pedido. Ativo sem posição aberta devolve `position` nulo e o ' +
          'histórico inteiro: a posição zerada sai de Posições e fica aqui.',
        schema: assetPageResourceSchema,
      },
      400: {
        description:
          'Identificador que não é um UUID, janela desconhecida ou tipo de ' +
          'lançamento que não existe.',
        schema: errorResponseSchema,
      },
      404: {
        description:
          'Ativo inexistente. Um endereço velho precisa dizer que o papel não ' +
          'existe, e não parecer um papel sem histórico.',
        schema: errorResponseSchema,
      },
    },
  },
];
