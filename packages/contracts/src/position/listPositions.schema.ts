import { z } from 'zod';

import { uuid } from '../support/primitives.schema.js';
import { positionGroupBySchema } from './position.schema.js';

/**
 * O recorte da tela de Posições, que é também o que cabe na URL.
 *
 * Nenhum filtro é aplicado no navegador. Filtrar na tela seria mais rápido de
 * escrever e quebraria o subtotal no primeiro uso: o grupo somado pela `api`
 * passaria a descrever linhas que a tela escondeu. Quem filtra é quem soma.
 */
export const listPositionsSchema = z.object({
  query: z.object({
    portfolio_id: uuid,
    group_by: positionGroupBySchema.default('category'),
    /** Casa com código e com nome do ativo, sem distinguir maiúscula. */
    search: z.string().trim().max(120).optional(),
    /**
     * Uma ou mais categorias, separadas por vírgula. `sem-categoria` recorta as
     * linhas que não têm categoria nenhuma. Várias valem como "qualquer uma".
     */
    category_id: z.string().trim().max(600).optional(),
    /** Uma ou mais instituições, separadas por vírgula; `sem-instituicao` vale como acima. */
    institution_id: z.string().trim().max(600).optional(),
  }),
});

export type ListPositionsQuery = z.infer<typeof listPositionsSchema>['query'];

/** A chave de grupo das linhas sem categoria, sem instituição ou sem grupo. */
export const UNCATEGORIZED_KEY = 'sem-categoria';
export const NO_INSTITUTION_KEY = 'sem-instituicao';
export const UNGROUPED_KEY = 'sem-grupo';
