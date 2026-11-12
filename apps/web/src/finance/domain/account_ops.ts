import type { IsoDate } from '../lib/dates.js';
import { parseMoneyInput } from '../lib/format.js';
import { normalizeText } from '../lib/text.js';
import { accountBalance } from './accounts.js';
import type { Account, AccountType, FinanceData } from './types.js';

/**
 * FIN-404 · Nova conta e editar conta.
 *
 * O nome é único entre as contas. O saldo é sempre o inicial mais as
 * movimentações (RN-31), então editar o saldo inicial move o saldo atual no
 * mesmo valor e a conta continua fechando. O tipo não muda depois de criada: o
 * que a conta já recebeu e pagou depende dele.
 */

export type AccountDraft = {
  readonly name: string;
  readonly role: string;
  readonly type: AccountType;
  readonly initial: string;
};

export type AccountErrors = Partial<Record<'name' | 'initial', string>>;

export const emptyAccountDraft = (): AccountDraft => ({
  name: '',
  role: '',
  type: 'conta',
  initial: '',
});

const toInput = (cents: number): string => (cents / 100).toFixed(2).replace('.', ',');

export const draftOfAccount = (account: Account): AccountDraft => ({
  name: account.name,
  role: account.role,
  type: account.type,
  initial: toInput(account.initialCents),
});

export const validateAccount = (
  data: FinanceData,
  draft: AccountDraft,
  editingId?: string,
): AccountErrors => {
  const errors: Record<string, string> = {};
  const name = draft.name.trim();
  if (name === '') errors['name'] = 'Dê um nome.';
  else if (
    data.accounts.some(
      (account) =>
        account.id !== editingId && normalizeText(account.name) === normalizeText(name),
    )
  ) {
    errors['name'] = 'Já existe uma conta com esse nome.';
  }

  const initial = parseMoneyInput(draft.initial);
  if (initial === null || initial < 0)
    errors['initial'] = 'Informe o saldo inicial (pode ser zero).';

  return errors;
};

const slug = (name: string): string =>
  normalizeText(name)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const uniqueId = (data: FinanceData, name: string): string => {
  const base = slug(name) || 'conta';
  const ids = new Set(data.accounts.map((account) => account.id));
  let candidate = base;
  for (let n = 2; ids.has(candidate); n += 1) candidate = `${base}-${n}`;
  return candidate;
};

export const addAccount = (data: FinanceData, draft: AccountDraft): FinanceData => {
  if (Object.keys(validateAccount(data, draft)).length > 0) return data;
  const account: Account = {
    id: uniqueId(data, draft.name),
    name: draft.name.trim(),
    role: draft.role.trim(),
    type: draft.type,
    initialCents: parseMoneyInput(draft.initial) ?? 0,
  };
  return { ...data, accounts: [...data.accounts, account] };
};

export const updateAccount = (
  data: FinanceData,
  id: string,
  draft: AccountDraft,
): FinanceData => {
  const current = data.accounts.find((account) => account.id === id);
  if (current === undefined) return data;
  if (Object.keys(validateAccount(data, { ...draft, type: current.type }, id)).length > 0)
    return data;
  const role = draft.role.trim();
  const updated: Account = {
    id: current.id,
    name: draft.name.trim(),
    role,
    ...(role === current.role && current.roleTag !== undefined
      ? { roleTag: current.roleTag }
      : {}),
    ...(current.institution === undefined ? {} : { institution: current.institution }),
    type: current.type,
    initialCents: parseMoneyInput(draft.initial) ?? current.initialCents,
    ...(current.archived === undefined ? {} : { archived: current.archived }),
  };
  return {
    ...data,
    accounts: data.accounts.map((account) => (account.id === id ? updated : account)),
  };
};

/**
 * FIN-409 · Arquivar conta (RN-38).
 *
 * A conta arquivada sai de Contas, do total em contas e das opções de origem e
 * destino, mas continua nos lançamentos e extratos antigos. Conta que paga um
 * cartão não pode ser arquivada. Saldo diferente de zero exige confirmação.
 */
export const archiveBlockedReason = (data: FinanceData, id: string): string | null => {
  const account = data.accounts.find((a) => a.id === id);
  if (account === undefined) return 'Conta não encontrada.';
  const cards = data.cards.filter((card) => card.payerId === id).map((card) => card.name);
  if (cards.length === 0) return null;
  return `${account.name} paga ${cards.length === 1 ? 'o cartão' : 'os cartões'} ${cards.join(' e ')}. Passe a fatura para outra conta antes de arquivar.`;
};

export const archiveAccount = (
  data: FinanceData,
  id: string,
  today: IsoDate,
  confirmedBalance = false,
): FinanceData => {
  const account = data.accounts.find((a) => a.id === id);
  if (account === undefined || account.archived === true) return data;
  if (archiveBlockedReason(data, id) !== null) return data;
  if (!confirmedBalance && accountBalance(data, id, today) !== 0) return data;
  return {
    ...data,
    accounts: data.accounts.map((a) => (a.id === id ? { ...a, archived: true } : a)),
  };
};

export const restoreAccount = (data: FinanceData, id: string): FinanceData => {
  const account = data.accounts.find((a) => a.id === id);
  if (account === undefined || account.archived !== true) return data;
  const restored: Account = {
    id: account.id,
    name: account.name,
    role: account.role,
    ...(account.roleTag === undefined ? {} : { roleTag: account.roleTag }),
    ...(account.institution === undefined ? {} : { institution: account.institution }),
    type: account.type,
    initialCents: account.initialCents,
  };
  return {
    ...data,
    accounts: data.accounts.map((a) => (a.id === id ? restored : a)),
  };
};
