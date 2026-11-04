import type { DateOnly } from '../support/date_only.js';

/**
 * A troca de custodiante: o papel sai de uma instituição e vai para outra, sem
 * vender e sem comprar. Quantidade, preço médio, caixa e resultado realizado
 * não mudam — por isso ela não é um lançamento.
 *
 * É tabela de fonte: o usuário a escreve, e o backup precisa dela.
 */
export type CustodyTransfer = {
  readonly id: string;
  readonly portfolio_id: string;
  readonly asset_id: string;
  readonly from_institution_id: string;
  readonly to_institution_id: string;
  readonly transfer_date: DateOnly;
  readonly note: string | null;
  readonly created_at: string;
};
