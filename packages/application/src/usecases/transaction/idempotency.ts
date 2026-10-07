import type { Transaction } from '@patrimonio/domain';
import { success } from '@patrimonio/shared';
import type { Either } from '@patrimonio/shared';

import type { AppError } from '../../errors/app-error.js';
import type { TransactionalRepositories } from '../../interfaces/unit-of-work.js';

/**
 * A chave vale por 24 horas. Depois disso ela é liberada, e o mesmo cabeçalho
 * volta a valer para um lançamento novo — do contrário o índice único guardaria
 * para sempre uma chave que o cliente já esqueceu.
 */
export const IDEMPOTENCY_TTL_HOURS = 24;

/**
 * Clique duplo no botão de salvar chega como dois requests com a mesma chave. O
 * segundo encontra o primeiro aqui e devolve o lançamento que já existe, em vez
 * de criar outro.
 *
 * O preview não é recalculado no replay de propósito: ele descreve o efeito no
 * estado em que o lançamento foi criado, e refazê-lo agora — com o que veio
 * depois — produziria números diferentes dos que a tela mostrou.
 */
export const findReplay = async (
  repositories: TransactionalRepositories,
  key: string | undefined,
): Promise<Either<AppError, Transaction | null>> => {
  if (key === undefined || key === '') return success(null);

  const expired =
    await repositories.transactions.expireIdempotencyKeys(IDEMPOTENCY_TTL_HOURS);
  if (expired.isFailure()) return expired;

  return repositories.transactions.findByIdempotencyKey(key);
};

/** As duas pernas de uma transferência voltam juntas no replay. */
export const replayGroup = async (
  repositories: TransactionalRepositories,
  replayed: Transaction,
): Promise<Either<AppError, Transaction[]>> => {
  if (replayed.transfer_group_id === null) return success([replayed]);

  return repositories.transactions.findByTransferGroup(replayed.transfer_group_id);
};
