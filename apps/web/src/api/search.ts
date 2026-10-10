import { searchResourceSchema } from '@patrimonio/contracts';
import type { SearchResource } from '@patrimonio/contracts';

import { request } from './client.js';

/**
 * T-09 · A busca global.
 *
 * Só ativo e lançamento passam por aqui. Tela, carteira e ação o navegador já
 * tem, e é por isso que a paleta abre antes de qualquer resposta chegar. O
 * texto vai como a pessoa o digitou, aparado: acento e maiúscula quem trata é a
 * `api`, que compara do mesmo jeito que a paleta pontua.
 */

/** O limite da `api` para o texto. O campo da paleta usa o mesmo. */
export const SEARCH_TEXT_MAX = 80;

export const fetchSearch = async (
  text: string,
  portfolioId: string,
  signal?: AbortSignal,
): Promise<SearchResource> =>
  request(
    `/api/search?${new URLSearchParams({
      q: text.trim().slice(0, SEARCH_TEXT_MAX),
      portfolio_id: portfolioId,
    }).toString()}`,
    searchResourceSchema,
    { ...(signal === undefined ? {} : { signal }) },
  );
