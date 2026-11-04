import { addMonths, parseIso, startOfMonth } from '../lib/dates.js';
import type { IsoDate } from '../lib/dates.js';
import { parseMoneyInput } from '../lib/format.js';
import { normalizeText } from '../lib/text.js';
import { accountBalance } from './accounts.js';
import { CARDS } from './sources.js';
import type { Account, AccountType, FinanceData } from './types.js';

/**
 * FIN-404 · Nova conta e editar conta.
 *
 * O nome é único entre contas e benefícios. O saldo é sempre o inicial mais as
 * movimentações (RN-31), então editar o saldo inicial move o saldo atual no
 * mesmo valor e a conta continua fechando. O tipo não muda depois de criada: o
 * que a conta já recebeu e pagou depende dele.
 */

export type AccountDraft = {
  readonly name: string;
  readonly role: string;
  readonly type: AccountType;
  readonly initial: string;
  /** Benefício: valor e dia do crédito mensal. */
  readonly creditValue: string;
  readonly creditDay: string;
};

export type AccountErrors = Partial<
  Record<'name' | 'initial' | 'creditValue' | 'creditDay', string>
>;

export const emptyAccountDraft = (): AccountDraft => ({
  name: '',
  role: '',
  type: 'conta',
  initial: '',
  creditValue: '',
  creditDay: '',
});

const toInput = (cents: number): string => (cents / 100).toFixed(2).replace('.', ',');

export const draftOfAccount = (account: Account): AccountDraft => ({
  name: account.name,
  role: account.role,
  type: account.type,
  initial: toInput(account.initialCents),
  creditValue: account.creditCents === undefined ? '' : toInput(account.creditCents),
  creditDay: account.creditDay === undefined ? '' : String(account.creditDay),
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
    errors['name'] = 'Já existe uma conta ou benefício com esse nome.';
  }

  const initial = parseMoneyInput(draft.initial);
  if (initial === null || initial < 0)
    errors['initial'] = 'Informe o saldo inicial (pode ser zero).';

  if (draft.type === 'beneficio') {
    const credit = parseMoneyInput(draft.creditValue);
    if (credit === null || credit <= 0)
      errors['creditValue'] = 'Informe o valor do crédito mensal.';
    const day = Number(draft.creditDay);
    if (!/^\d+$/.test(draft.creditDay) || day < 1 || day > 31)
      errors['creditDay'] = 'Informe um dia de 1 a 31.';
  }
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

/** O primeiro mês em que o crédito é gerado: este, se o dia ainda não passou. */
const firstCreditMonth = (day: number, today: IsoDate): IsoDate =>
  parseIso(today).day <= day ? startOfMonth(today) : startOfMonth(addMonths(today, 1));

const creditFields = (
  draft: AccountDraft,
  today: IsoDate,
  previous?: Account,
): Pick<Account, 'creditCents' | 'creditDay' | 'creditsFrom'> => {
  if (draft.type !== 'beneficio') return {};
  const creditCents = parseMoneyInput(draft.creditValue) ?? 0;
  const creditDay = Number(draft.creditDay);
  return {
    creditCents,
    creditDay,
    creditsFrom: previous?.creditsFrom ?? firstCreditMonth(creditDay, today),
  };
};

export const addAccount = (
  data: FinanceData,
  draft: AccountDraft,
  today: IsoDate,
): FinanceData => {
  if (Object.keys(validateAccount(data, draft)).length > 0) return data;
  const account: Account = {
    id: uniqueId(data, draft.name),
    name: draft.name.trim(),
    role: draft.role.trim(),
    type: draft.type,
    initialCents: parseMoneyInput(draft.initial) ?? 0,
    ...creditFields(draft, today),
  };
  return { ...data, accounts: [...data.accounts, account] };
};

export const updateAccount = (
  data: FinanceData,
  id: string,
  draft: AccountDraft,
  today: IsoDate,
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
    ...creditFields({ ...draft, type: current.type }, today, current),
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
  const cards = CARDS.filter((card) => card.payerId === id).map((card) => card.name);
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
    ...(account.creditCents === undefined ? {} : { creditCents: account.creditCents }),
    ...(account.creditDay === undefined ? {} : { creditDay: account.creditDay }),
    ...(account.creditsFrom === undefined ? {} : { creditsFrom: account.creditsFrom }),
  };
  return {
    ...data,
    accounts: data.accounts.map((a) => (a.id === id ? restored : a)),
  };
};
