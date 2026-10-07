import type { DateOnly } from '../support/date_only.js';

/**
 * O preço definido à mão, por data. Ele vale até a fonte automática voltar a
 * responder para aquele ativo — e enquanto vale, a tabela mostra o número
 * marcado como manual, porque um preço digitado e um preço de fechamento não
 * merecem a mesma confiança.
 *
 * É tabela de fonte, não de mercado: o usuário a escreve, e o backup precisa
 * dela.
 */
export type ManualPrice = {
  readonly asset_id: string;
  readonly price_date: DateOnly;
  readonly price: string;
  readonly created_at: string;
  readonly updated_at: string;
};
