import { assetPageResourceSchema } from '@patrimonio/contracts';
import type { AssetPageResource, AssetPeriod } from '@patrimonio/contracts';
import type { TransactionKind } from '@patrimonio/domain';

import { request } from './client.js';

/**
 * T-03 · A página do ativo, em um pedido.
 *
 * Todo filtro vai para a `api`, pela razão de T-02: quem filtra é quem soma. A
 * janela do gráfico recorta a série **e** a variação do período, e o tipo de
 * lançamento recorta a lista **e** a contagem — recortar no navegador faria as
 * duas descreverem conjuntos diferentes.
 */
export type AssetPageRequest = {
  readonly assetId: string;
  readonly portfolioId: string | null;
  readonly period: AssetPeriod;
  readonly kind: TransactionKind | null;
};

export const assetPageQuery = (input: AssetPageRequest): URLSearchParams => {
  const params = new URLSearchParams();

  if (input.portfolioId !== null) params.set('portfolio_id', input.portfolioId);
  params.set('period', input.period);
  if (input.kind !== null) params.set('kind', input.kind);

  return params;
};

export const fetchAssetPage = async (
  input: AssetPageRequest,
  signal?: AbortSignal,
): Promise<AssetPageResource> =>
  request(
    `/api/assets/${encodeURIComponent(input.assetId)}/page?${assetPageQuery(
      input,
    ).toString()}`,
    assetPageResourceSchema,
    { ...(signal === undefined ? {} : { signal }) },
  );
