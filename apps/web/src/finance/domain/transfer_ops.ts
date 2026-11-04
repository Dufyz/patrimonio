import { compareDates } from '../lib/dates.js';
import type { IsoDate } from '../lib/dates.js';
import { parseMoneyInput } from '../lib/format.js';
import { accountLabel } from './accounts.js';
import type { Account, FinanceData, Movement } from './types.js';

/**
 * FIN-403 · Transferir entre contas (RN-34).
 *
 * Duas pernas ligadas por `transferId`: debita a origem e credita o destino. Não
 * é receita nem despesa, então Lançamentos e as categorias não mudam, e o total
 * em contas também não — o dinheiro só muda de lugar.
 */

export type TransferDraft = {
  readonly fromId: string;
  readonly toId: string;
  readonly value: string;
  readonly date: IsoDate;
  readonly description: string;
};

export type TransferErrors = Partial<
  Record<'fromId' | 'toId' | 'value' | 'date', string>
>;

export const emptyTransferDraft = (today: IsoDate, fromId = ''): TransferDraft => ({
  fromId,
  toId: '',
  value: '',
  date: today,
  description: '',
});

/** Origem e destino são contas ativas; benefício só recebe crédito (RN-36). */
export const transferAccounts = (data: FinanceData): readonly Account[] =>
  data.accounts.filter((a) => a.type === 'conta' && a.archived !== true);

export const validateTransfer = (
  data: FinanceData,
  draft: TransferDraft,
  today: IsoDate,
): TransferErrors => {
  const errors: Record<string, string> = {};
  const accounts = transferAccounts(data);
  if (!accounts.some((a) => a.id === draft.fromId))
    errors['fromId'] = 'Escolha a conta de origem.';
  if (!accounts.some((a) => a.id === draft.toId))
    errors['toId'] = 'Escolha a conta de destino.';
  else if (draft.toId === draft.fromId)
    errors['toId'] = 'Origem e destino precisam ser contas diferentes.';
  const cents = parseMoneyInput(draft.value);
  if (cents === null || cents <= 0) errors['value'] = 'Informe um valor maior que zero.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date)) errors['date'] = 'Informe a data.';
  else if (compareDates(draft.date, today) > 0)
    errors['date'] = 'Transferência só vale até hoje.';
  return errors;
};

const nextTransferId = (data: FinanceData): string => {
  const ids = new Set(data.movements.map((m) => m.transferId ?? m.id));
  let n = 1;
  while (ids.has(`m-transf-${n}`)) n += 1;
  return `m-transf-${n}`;
};

/** Registra a transferência; com erro, devolve os mesmos dados. */
export const addTransfer = (
  data: FinanceData,
  draft: TransferDraft,
  today: IsoDate,
): FinanceData => {
  if (Object.keys(validateTransfer(data, draft, today)).length > 0) return data;
  const cents = parseMoneyInput(draft.value) ?? 0;
  const transferId = nextTransferId(data);
  const note = draft.description.trim();
  const base = { date: draft.date, kind: 'transferencia' as const, transferId };
  const out: Movement = {
    ...base,
    id: `${transferId}-saida`,
    accountId: draft.fromId,
    cents: -cents,
    description: `Transferência para ${accountLabel(data, draft.toId)}`,
    ...(note === '' ? {} : { note }),
  };
  const entry: Movement = {
    ...base,
    id: `${transferId}-entrada`,
    accountId: draft.toId,
    cents,
    description: `Transferência de ${accountLabel(data, draft.fromId)}`,
    ...(note === '' ? {} : { note }),
  };
  return { ...data, movements: [...data.movements, out, entry] };
};
