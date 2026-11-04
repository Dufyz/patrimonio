/**
 * As origens de pagamento: conta, benefício ou cartão.
 *
 * Até as telas de Contas e Cartões existirem (fases 4 e 5), vêm deste cadastro
 * mínimo, com os nomes das pranchas. Elas passam a ler o cadastro de verdade.
 */

export type SourceType = 'conta' | 'beneficio' | 'cartao';

export type PaymentSource = {
  readonly id: string;
  readonly name: string;
  readonly type: SourceType;
  /** Cartão: a conta que paga a fatura (RN-40). */
  readonly payerId?: string;
};

export const SOURCES: readonly PaymentSource[] = [
  { id: 'itau-corrente', name: 'Itaú Corrente', type: 'conta' },
  { id: 'nubank-conta', name: 'Nubank Conta', type: 'conta' },
  { id: 'carteira', name: 'Carteira', type: 'conta' },
  { id: 'flex', name: 'Flex', type: 'beneficio' },
  { id: 'itau-visa', name: 'Itaú Visa', type: 'cartao', payerId: 'itau-corrente' },
  {
    id: 'nubank-master',
    name: 'Nubank Mastercard',
    type: 'cartao',
    payerId: 'nubank-conta',
  },
];

export const sourceName = (id: string): string =>
  SOURCES.find((source) => source.id === id)?.name ?? id;
