import type { FinanceData } from './types.js';

/**
 * As origens de pagamento: conta ou cartão.
 *
 * As contas vêm do cadastro (`data.accounts`, FIN-404), de modo que
 * uma conta nova já é uma origem possível. Os cartões vêm do cadastro de
 * cartões (`data.cards`, FIN-503).
 */

export type SourceType = 'conta' | 'cartao';

export type PaymentSource = {
  readonly id: string;
  readonly name: string;
  readonly type: SourceType;
  /** Cartão: a conta que paga a fatura (RN-40). */
  readonly payerId?: string;
};

/** Todas as origens conhecidas, inclusive de conta arquivada: o histórico as cita. */
export const allSources = (data: FinanceData): readonly PaymentSource[] => [
  ...data.accounts.map((account) => ({
    id: account.id,
    name: account.name,
    type: account.type,
  })),
  ...data.cards.map((card) => ({
    id: card.id,
    name: card.name,
    type: 'cartao' as const,
    payerId: card.payerId,
  })),
];

/** As origens que se pode escolher hoje: conta arquivada sai das opções (RN-38). */
export const activeSources = (data: FinanceData): readonly PaymentSource[] => {
  const archived = new Set(
    data.accounts.filter((account) => account.archived === true).map((a) => a.id),
  );
  return allSources(data).filter((source) => !archived.has(source.id));
};

export const findSource = (data: FinanceData, id: string): PaymentSource | undefined =>
  allSources(data).find((source) => source.id === id);

export const sourceName = (data: FinanceData, id: string): string =>
  findSource(data, id)?.name ?? id;
