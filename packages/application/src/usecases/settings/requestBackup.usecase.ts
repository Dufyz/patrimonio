import { dedupeKey } from '@patrimonio/domain';
import type { DateOnly } from '@patrimonio/domain';
import { either, failure, success } from '@patrimonio/shared';

import { BadRequestError } from '../../errors/app-error.js';
import type { Clock } from '../../interfaces/clock.js';
import type { EnqueuedEvent } from '../../interfaces/outbox.repository.js';
import type { UnitOfWork } from '../../interfaces/unit-of-work.js';

/**
 * "Fazer backup agora": enfileira e devolve na hora, como "atualizar agora" dos
 * dados de mercado. O dump leva o tempo do banco, e a tela não pode esperar por
 * ele — então a rota responde 202 com `job_id` e `already_queued`.
 *
 * Duas decisões:
 *
 * - **Backup desligado não enfileira.** O estágio, ao rodar, diria "desligado
 *   nesta instalação: nada a fazer" e terminaria com sucesso; a tela
 *   mostraria "backup pedido" e nenhum arquivo apareceria no bucket. Recusar
 *   aqui, com a razão, é o que impede o botão de prometer o que não vai
 *   acontecer.
 * - **A chave é a do dia.** `backup:<data>` coalesce dois cliques seguidos num
 *   backup só, e não impede o das 03:00 de rodar depois — a coalescência vale
 *   para pedidos pendentes, não para os que já terminaram. Um backup feito de
 *   tarde grava no mesmo nome do dia: a versão mais recente do dia é a que
 *   fica no bucket, e a retenção continua contando um por dia.
 */
export type RequestBackupDeps = {
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly backupEnabled: boolean;
};

export type RequestBackupInput = {
  readonly origin_request_id?: string | undefined;
};

export type RequestBackupResult = {
  readonly reference_date: DateOnly;
  readonly queued: EnqueuedEvent;
};

export const requestBackup = (deps: RequestBackupDeps) =>
  either(async function* (input: RequestBackupInput) {
    if (!deps.backupEnabled) {
      return yield* failure(
        new BadRequestError(
          'O backup está desligado nesta instalação. Ligue BACKUP_ENABLED e configure ' +
            'a chave e o destino antes de pedir um backup.',
        ),
      );
    }

    const date = deps.clock.today();

    return yield* await deps.unitOfWork.run<BadRequestError, RequestBackupResult>(
      async (repositories) => {
        const enqueued = await repositories.outbox.enqueue([
          {
            stage: 'backup',
            dedupe_key: dedupeKey.backup(date),
            payload: { reference_date: date },
            ...(input.origin_request_id === undefined
              ? {}
              : { origin_request_id: input.origin_request_id }),
          },
        ]);
        if (enqueued.isFailure()) return enqueued;

        const queued = enqueued.value[0];
        if (queued === undefined) {
          return failure(
            new BadRequestError('O pedido de backup não produziu evento nenhum'),
          );
        }

        return success({ reference_date: date, queued });
      },
    );
  });
