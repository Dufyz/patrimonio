import { finance as fin } from '@patrimonio/calc';
import type { FinSnapshot } from '@patrimonio/domain';
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

export type ProventoPlan = {
  readonly before: FinSnapshot;
  readonly after: FinSnapshot;
  readonly effect: AccountEffect;
};

/**
 * LIV-05/LIV-07 · A perna financeira do provento em memória: valida a conta de
 * destino e devolve o antes → depois sem gravar. O preview e a gravação passam
 * por aqui, e por isso o que o modal mostra é o que fica.
 */
export const planProvento = async (
  repositories: TransactionalRepositories,
  input: ProventoLegInput,
): Promise<Either<AppError, ProventoPlan>> => {
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

  return success({
    before,
    after,
    effect: {
      account_id: input.account_id,
      before: fin.money(
        fin.accountBalance(before, input.account_id, input.today as never),
      ),
      after: fin.money(fin.accountBalance(after, input.account_id, input.today as never)),
    },
  });
};

/** Grava a perna planejada na transação de quem chama e devolve o efeito. */
export const creditProvento = async (
  repositories: TransactionalRepositories,
  input: ProventoLegInput,
): Promise<Either<AppError, AccountEffect>> => {
  const planned = await planProvento(repositories, input);
  if (planned.isFailure()) return planned;

  const saved = await repositories.finance.persist(
    fin.diffSnapshots(planned.value.before, planned.value.after),
  );
  if (saved.isFailure()) return saved;

  return success(planned.value.effect);
};
