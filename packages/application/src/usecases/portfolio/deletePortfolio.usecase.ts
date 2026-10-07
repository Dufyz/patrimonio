import { dedupeKey } from '@patrimonio/domain';
import type { OutboxEventDraft } from '@patrimonio/domain';
import { either, failure, success } from '@patrimonio/shared';

import {
  BadRequestError,
  ConflictError,
  InvalidParameterError,
  NotFoundError,
} from '../../errors/app-error.js';
import type { AppError } from '../../errors/app-error.js';
import type { UnitOfWork } from '../../interfaces/unit-of-work.js';

export type DeletePortfolioInput = {
  /** O nome digitado pelo usuário. Clicar não basta quando o estrago é anos. */
  readonly confirm_name: string;
  readonly transactions: 'move' | 'delete';
  readonly destination_portfolio_id?: string | undefined;
  readonly origin_request_id?: string | undefined;
};

export type DeletePortfolioResult = {
  readonly deleted_portfolio_id: string;
  readonly moved_transactions: number;
  readonly deleted_transactions: number;
};

export type DeletePortfolioDeps = { readonly unitOfWork: UnitOfWork };

/**
 * Excluir uma carteira é a operação mais destrutiva do cadastro: ou o conteúdo
 * muda de carteira — e aí o patrimônio total não muda, só a leitura por
 * propósito — ou o histórico some, e aí o patrimônio de todas as datas muda.
 * As duas exigem digitar o nome.
 */
export const deletePortfolio = (deps: DeletePortfolioDeps) =>
  either(async function* (id: string, input: DeletePortfolioInput) {
    return yield* await deps.unitOfWork.run<AppError, DeletePortfolioResult>(
      async (repositories) => {
        const found = await repositories.portfolios.findById(id);
        if (found.isFailure()) return found;
        if (found.value === null) {
          return failure(new NotFoundError(`Carteira ${id} não encontrada`));
        }

        const portfolio = found.value;

        if (input.confirm_name.trim() !== portfolio.name) {
          return failure(
            new InvalidParameterError(
              'O nome digitado não confere com o da carteira que será excluída',
            ),
          );
        }

        const summary = await repositories.portfolios.contentSummary(id);
        if (summary.isFailure()) return summary;

        let moved = 0;
        let deleted = 0;
        const events: OutboxEventDraft[] = [];

        if (summary.value.transactions > 0) {
          if (input.transactions === 'move') {
            const destination = input.destination_portfolio_id;

            if (destination === undefined || destination === id) {
              return failure(
                new BadRequestError(
                  'Mover o conteúdo exige uma carteira de destino diferente desta',
                ),
              );
            }

            const target = await repositories.portfolios.findById(destination);
            if (target.isFailure()) return target;
            if (target.value === null) {
              return failure(
                new BadRequestError(`Carteira de destino ${destination} não existe`),
              );
            }

            const result = await repositories.portfolios.moveContent(id, destination);
            if (result.isFailure()) return result;

            moved = result.value.moved;

            // O destino passa a ter lançamentos antigos: a projeção dele
            // precisa ser reconstruída desde o mais antigo que chegou.
            if (result.value.from_date !== null) {
              events.push({
                stage: 'recalc',
                dedupe_key: dedupeKey.recalc(destination),
                payload: {
                  portfolio_id: destination,
                  from_date: result.value.from_date,
                },
                ...(input.origin_request_id === undefined
                  ? {}
                  : { origin_request_id: input.origin_request_id }),
              });
            }
          } else {
            const removed = await repositories.portfolios.deleteTransactions(id);
            if (removed.isFailure()) return removed;
            deleted = removed.value;
          }
        }

        const dropped = await repositories.portfolios.remove(id);
        if (dropped.isFailure()) return dropped;
        if (!dropped.value) {
          return failure(
            new ConflictError(
              'A carteira ainda tem conteúdo ligado a ela e não pôde ser excluída',
            ),
          );
        }

        if (events.length > 0) {
          const enqueued = await repositories.outbox.enqueue(events);
          if (enqueued.isFailure()) return enqueued;
        }

        return success({
          deleted_portfolio_id: id,
          moved_transactions: moved,
          deleted_transactions: deleted,
        });
      },
    );
  });
