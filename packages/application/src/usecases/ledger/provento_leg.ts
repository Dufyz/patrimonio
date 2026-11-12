import { finance as fin } from '@patrimonio/calc';
import { failure, success } from '@patrimonio/shared';
import type { Either } from '@patrimonio/shared';

import type { AppError } from '../../errors/app-error.js';
import { FinanceError } from '../../errors/finance-error.js';
import type { TransactionalRepositories } from '../../interfaces/unit-of-work.js';
import type { AccountEffect } from './contribution.usecase.js';

const rule = (code: string, message: string, field: string, status = 422) =>
  failure(new FinanceError([{ code, message, field }], status));

export type ProventoLegInput = {
  readonly account_id: string;
  readonly date: string;
  readonly amount: string;
  readonly ticker: string;
  readonly event_id: string;
  readonly today: string;
};

/**
 * LIV-05 · A perna financeira do provento: o líquido creditado na conta, ligado
 * à perna de posição pelo `event_id`. Valida a conta de destino, grava na mesma
 * transação de quem chama e devolve o efeito antes → depois.
 */
export const creditProvento = async (
  repositories: TransactionalRepositories,
  input: ProventoLegInput,
): Promise<Either<AppError, AccountEffect>> => {
  const loaded = await repositories.finance.load();
  if (loaded.isFailure()) return loaded;
  const before = loaded.value;

  if (before.cards.some((card) => card.id === input.account_id)) {
    return rule(
      'PROVENTO_DESTINO_CARTAO',
      'O provento não pode ser creditado num cartão. Escolha uma conta.',
      'account_id',
    );
  }
  const account = before.accounts.find((a) => a.id === input.account_id);
  if (account === undefined) {
    return rule(
      'CONTA_NAO_ENCONTRADA',
      'A conta de destino não existe.',
      'account_id',
      404,
    );
  }
  if (account.archived) {
    return rule(
      'CONTA_ARQUIVADA',
      'A conta de destino está arquivada.',
      'account_id',
      409,
    );
  }

  const after = {
    ...before,
    movements: [
      ...before.movements,
      {
        id: repositories.transactions.nextId(),
        date: input.date,
        account_id: input.account_id,
        kind: 'provento' as const,
        amount: fin.money(fin.dec(input.amount).abs()),
        description: `Provento de ${input.ticker}`,
        note: null,
        transfer_id: null,
        event_id: input.event_id,
      },
    ],
  };

  const saved = await repositories.finance.persist(fin.diffSnapshots(before, after));
  if (saved.isFailure()) return saved;

  return success({
    account_id: input.account_id,
    before: fin.money(fin.accountBalance(before, input.account_id, input.today as never)),
    after: fin.money(fin.accountBalance(after, input.account_id, input.today as never)),
  });
};
