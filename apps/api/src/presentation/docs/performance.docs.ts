import {
  errorResponseSchema,
  getPerformanceSchema,
  performanceSchema,
} from '@patrimonio/contracts';

import type { RouteDoc } from './route-doc.js';

const TAG = 'Desempenho';

export const PERFORMANCE_ROUTE_DOCS: readonly RouteDoc[] = [
  {
    method: 'get',
    path: '/performance',
    tag: TAG,
    summary:
      'A carteira contra os benchmarks, mês a mês, e o saldo decomposto em aporte e rendimento',
    request: getPerformanceSchema,
    responses: {
      200: {
        description:
          'Uma resposta para a tela inteira, em duas consultas. O retorno da carteira sai da ' +
          'cota — gravada com uma carteira, construída sobre a história inteira no consolidado — ' +
          'e o da classe de ativo, que não tem cota, é Dietz modificado; o campo `method` ' +
          'declara qual. Retorno ausente é nulo, nunca zero: janela maior que o histórico e ' +
          'classe sem capital no período chegam como null. Nenhum número é anualizado.',
        schema: performanceSchema,
      },
      404: {
        description: 'Carteira não encontrada.',
        schema: errorResponseSchema,
      },
    },
  },
];
