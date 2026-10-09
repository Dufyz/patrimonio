import { setManualPriceResponseSchema } from '@patrimonio/contracts';
import type { SetManualPriceResponse } from '@patrimonio/contracts';

import { request } from './client.js';

/**
 * L-14 · O preço definido à mão, por data.
 *
 * Vale até a fonte automática voltar a responder para aquele ativo, e a linha
 * fica marcada como manual enquanto vale. A resposta traz o antes → depois do
 * valor da posição, que é o mesmo cálculo que fica gravado — nunca uma
 * aproximação feita na tela.
 */
export const setManualPrice = async (
  assetId: string,
  body: { readonly price_date: string; readonly price: string },
): Promise<SetManualPriceResponse> =>
  request(`/api/assets/${assetId}/manual-price`, setManualPriceResponseSchema, {
    method: 'POST',
    body: JSON.stringify(body),
  });
