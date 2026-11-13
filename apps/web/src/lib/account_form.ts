import type { AccountRequest } from '../api/account_write.js';

/**
 * CTA-05 · O que o formulário de conta valida antes de mandar: nome único,
 * saldo de abertura não negativo e data de abertura. O servidor repete as
 * regras; aqui só se evita a ida e volta.
 */
export type AccountDraft = {
  readonly name: string;
  readonly role: string;
  readonly type: AccountRequest['type'];
  readonly institution: string;
  readonly openingAmount: string;
  readonly openingDate: string;
  readonly inWealth: boolean;
};

export const ACCOUNT_TYPES: readonly { id: AccountRequest['type']; name: string }[] = [
  { id: 'corrente', name: 'Conta corrente' },
  { id: 'poupanca', name: 'Poupança' },
  { id: 'carteira', name: 'Carteira / dinheiro' },
];

export const newAccountDraft = (today: string): AccountDraft => ({
  name: '',
  role: '',
  type: 'corrente',
  institution: '',
  openingAmount: '0,00',
  openingDate: today,
  inWealth: true,
});

export type AccountErrors = Partial<
  Record<'name' | 'openingAmount' | 'openingDate', string>
>;

const normalize = (value: string): string =>
  value.trim().replace(/\./g, '').replace(',', '.');

const validAmount = (value: string): boolean =>
  /^\d+(\.\d{1,2})?$/.test(normalize(value));

export const validateAccount = (
  draft: AccountDraft,
  others: readonly string[],
): AccountErrors => {
  const errors: AccountErrors = {};
  const name = draft.name.trim();
  if (name === '') errors.name = 'Informe o nome da conta.';
  else if (others.some((n) => n.trim().toLowerCase() === name.toLowerCase()))
    errors.name = 'Já existe uma conta com esse nome.';
  if (!validAmount(draft.openingAmount))
    errors.openingAmount = 'Informe o saldo de abertura (zero ou mais).';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.openingDate))
    errors.openingDate = 'Informe a data de abertura.';
  return errors;
};

export const toAccountRequest = (draft: AccountDraft): AccountRequest => ({
  name: draft.name.trim(),
  type: draft.type,
  institution: draft.institution.trim() === '' ? null : draft.institution.trim(),
  role: draft.role.trim(),
  role_tag: null,
  opening_amount: normalize(draft.openingAmount),
  opening_date: draft.openingDate,
  in_wealth: draft.inWealth,
});

/**
 * CTA-06 · Arquivar: saldo diferente de zero pede transferir antes ou uma
 * confirmação explícita; saldo zero basta confirmar.
 */
export const needsExplicitConfirm = (balance: string): boolean =>
  !/^-?0*(\.0*)?$/.test(balance.trim());
