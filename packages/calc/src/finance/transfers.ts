import type { FinMovement, FinSnapshot } from '@patrimonio/domain';
import { failure, success } from '@patrimonio/shared';
import type { Either } from '@patrimonio/shared';

import { compareDates, isIsoDate } from './dates.js';
import { rule } from './errors.js';
import type { FinRuleError } from './errors.js';
import { findAccount, isBenefit } from './lookup.js';
import { dec, money } from './money.js';

/**
 * Transferir entre contas (RN-34). Duas pernas ligadas por `transfer_id`: debita a
 * origem e credita o destino, na mesma operação. Não é receita nem despesa, então
 * Lançamentos e categorias não mudam, e o total em contas também não — o dinheiro
 * só muda de lugar.
 */

export type TransferInput = {
  readonly from_account_id: string;
  readonly to_account_id: string;
  readonly amount: string;
  readonly date: string;
  readonly note?: string | null | undefined;
};

export const validateTransfer = (
  data: FinSnapshot,
  input: TransferInput,
  today: string,
): readonly FinRuleError[] => {
  const errors: FinRuleError[] = [];
  const from = findAccount(data, input.from_account_id);
  const to = findAccount(data, input.to_account_id);

  if (from === undefined || from.archived || isBenefit(from)) {
    errors.push(
      rule(
        'TRANSFER_SOURCE_INVALID',
        'Escolha uma conta de origem ativa (benefício não transfere).',
        {
          field: 'from_account_id',
        },
      ),
    );
  }
  if (to === undefined || to.archived || isBenefit(to)) {
    errors.push(
      rule(
        'TRANSFER_DESTINATION_INVALID',
        'Escolha uma conta de destino ativa (benefício só recebe crédito).',
        {
          field: 'to_account_id',
        },
      ),
    );
  } else if (input.to_account_id === input.from_account_id) {
    errors.push(
      rule('TRANSFER_SAME_ACCOUNT', 'Origem e destino precisam ser contas diferentes.', {
        field: 'to_account_id',
      }),
    );
  }
  if (!/^\d+(\.\d{1,2})?$/.test(input.amount) || dec(input.amount).lte(0)) {
    errors.push(
      rule('TRANSFER_AMOUNT_INVALID', 'Informe um valor maior que zero.', {
        field: 'amount',
      }),
    );
  }
  if (!isIsoDate(input.date)) {
    errors.push(rule('TRANSFER_DATE_INVALID', 'Informe a data.', { field: 'date' }));
  } else if (compareDates(input.date, today) > 0) {
    errors.push(
      rule('TRANSFER_DATE_INVALID', 'Transferência só vale até hoje.', { field: 'date' }),
    );
  }
  return errors;
};

const legs = (
  data: FinSnapshot,
  input: TransferInput,
  transferId: string,
  ids: readonly [string, string],
): readonly [FinMovement, FinMovement] => {
  const amount = dec(input.amount);
  const note = input.note?.trim() === '' ? null : (input.note?.trim() ?? null);
  const from = findAccount(data, input.from_account_id)?.name ?? input.from_account_id;
  const to = findAccount(data, input.to_account_id)?.name ?? input.to_account_id;
  return [
    {
      id: ids[0],
      date: input.date,
      account_id: input.from_account_id,
      kind: 'transferencia_saida',
      amount: money(amount.neg()),
      description: `Transferência para ${to}`,
      note,
      transfer_id: transferId,
    },
    {
      id: ids[1],
      date: input.date,
      account_id: input.to_account_id,
      kind: 'transferencia_entrada',
      amount: money(amount),
      description: `Transferência de ${from}`,
      note,
      transfer_id: transferId,
    },
  ];
};

export const createTransfer = (
  data: FinSnapshot,
  input: TransferInput,
  today: string,
  newId: () => string,
): Either<readonly FinRuleError[], { data: FinSnapshot; transfer_id: string }> => {
  const errors = validateTransfer(data, input, today);
  if (errors.length > 0) return failure(errors);

  const transferId = newId();
  const pair = legs(data, input, transferId, [newId(), newId()]);
  return success({
    data: { ...data, movements: [...data.movements, ...pair] },
    transfer_id: transferId,
  });
};

/** Editar uma perna aplica-se às duas: as pernas são reescritas mantendo os ids. */
export const updateTransfer = (
  data: FinSnapshot,
  transferId: string,
  input: TransferInput,
  today: string,
): Either<readonly FinRuleError[], FinSnapshot> => {
  const existing = data.movements.filter(
    (movement) => movement.transfer_id === transferId,
  );
  const out = existing.find((movement) => movement.kind === 'transferencia_saida');
  const into = existing.find((movement) => movement.kind === 'transferencia_entrada');
  if (out === undefined || into === undefined) {
    return failure([
      rule('TRANSFER_NOT_FOUND', 'Transferência não encontrada.', { status: 404 }),
    ]);
  }
  const errors = validateTransfer(data, input, today);
  if (errors.length > 0) return failure(errors);

  const [nextOut, nextIn] = legs(data, input, transferId, [out.id, into.id]);
  return success({
    ...data,
    movements: data.movements.map((movement) =>
      movement.id === out.id ? nextOut : movement.id === into.id ? nextIn : movement,
    ),
  });
};

/** Excluir uma perna exclui as duas. */
export const deleteTransfer = (data: FinSnapshot, transferId: string): FinSnapshot => ({
  ...data,
  movements: data.movements.filter((movement) => movement.transfer_id !== transferId),
});
