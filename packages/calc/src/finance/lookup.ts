import type {
  FinAccount,
  FinCard,
  FinCategory,
  FinEntry,
  FinRecurring,
  FinSnapshot,
  FinSource,
} from '@patrimonio/domain';

export const findAccount = (data: FinSnapshot, id: string): FinAccount | undefined =>
  data.accounts.find((account) => account.id === id);

export const findCard = (data: FinSnapshot, id: string): FinCard | undefined =>
  data.cards.find((card) => card.id === id);

export const findCategory = (data: FinSnapshot, id: string): FinCategory | undefined =>
  data.categories.find((category) => category.id === id);

export const findEntry = (data: FinSnapshot, id: string): FinEntry | undefined =>
  data.entries.find((entry) => entry.id === id);

export const findRecurring = (data: FinSnapshot, id: string): FinRecurring | undefined =>
  data.recurrings.find((recurring) => recurring.id === id);

/** O nome de uma origem de pagamento (conta ou cartão), ou o próprio id se sumiu. */
export const sourceName = (data: FinSnapshot, source: FinSource): string =>
  (source.type === 'conta'
    ? findAccount(data, source.id)?.name
    : findCard(data, source.id)?.name) ?? source.id;

/** A origem existe e está ativa (RN-38: conta arquivada sai das opções). */
export const isActiveSource = (data: FinSnapshot, source: FinSource): boolean => {
  if (source.type === 'conta') {
    const account = findAccount(data, source.id);
    return account !== undefined && !account.archived;
  }
  const card = findCard(data, source.id);
  return card !== undefined && !card.archived;
};

