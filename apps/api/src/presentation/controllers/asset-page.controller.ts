import type { getAssetPage } from '@patrimonio/application';
import type { GetAssetPageQuery } from '@patrimonio/contracts';
import type { RequestHandler } from 'express';

import { sendFailure, validatedQuery } from '../middleware/respond.js';

/**
 * T-03 · A página do ativo.
 *
 * Uma rota só, porque a tela é um assunto só: tudo sobre um ativo em um lugar.
 * Cinco rotas costuradas no navegador dariam cinco momentos em que metade da
 * tela está pronta, e o orçamento de consultas (T-11) é por rota, não por tela.
 *
 * O recorte — carteira, janela do gráfico e tipo de lançamento — vem na query,
 * que é o que a URL da tela carrega: colar o endereço em outra aba reproduz
 * exatamente o que estava na tela.
 *
 * Ativo inexistente é 404, decidido no caso de uso. O controller não sabe que
 * dia é hoje nem se o ativo existe: as duas coisas o tornariam não
 * determinístico e difícil de testar.
 */
export type AssetPageDeps = {
  readonly usecases: { readonly getAssetPage: ReturnType<typeof getAssetPage> };
};

export type AssetPageController = { readonly page: RequestHandler };

export const createAssetPageController = (deps: AssetPageDeps): AssetPageController => ({
  page: async (request, response) => {
    const query = validatedQuery<GetAssetPageQuery>(request);

    const result = await deps.usecases.getAssetPage({
      assetId: String(request.params['asset_id']),
      portfolioId: query.portfolio_id ?? null,
      period: query.period,
      kind: query.kind ?? null,
    });

    if (result.isFailure()) {
      sendFailure(request, response, result.value);
      return;
    }

    response.status(200).json(result.value);
  },
});
