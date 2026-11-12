import { finance as fin } from '@patrimonio/calc';
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
import { FinanceError } from '../../errors/finance-error.js';
import type { UnitOfWork } from '../../interfaces/unit-of-work.js';
import { portfolioLock } from '../transaction/createTransaction.usecase.js';

export type DeletePortfolioInput = {
  /** O nome digitado pelo usuário. Clicar não basta quando o estrago é anos. */
  readonly confirm_name: string;
  readonly transactions: 'move' | 'delete';
  readonly destination_portfolio_id?: string | undefined;
  readonly origin_request_id?: string | undefined;
  /** `updated_at` que a tela viu; obrigatório quando a carteira tem pernas financeiras. */
  readonly if_match?: string | undefined;
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
            // Os aportes com origem em conta voltam às contas: some a perna
            // financeira, a despesa ligada fica e deixa de apontar (CFG-05).
            const eventIds = await repositories.portfolios.legEventIds(id);
            if (eventIds.isFailure()) return eventIds;

            if (eventIds.value.length > 0) {
              if (input.if_match === undefined) {
                return failure(
                  new FinanceError(
                    [
                      {
                        code: 'IF_MATCH_OBRIGATORIO',
                        message:
                          'Informe If-Match com a versão que você viu para excluir esta carteira.',
                      },
                    ],
                    428,
                  ),
                );
              }
              if (
                new Date(input.if_match).getTime() !==
                new Date(portfolio.updated_at).getTime()
              ) {
                return failure(
                  new FinanceError(
                    [
                      {
                        code: 'VERSAO_DIVERGENTE',
                        message: 'A carteira mudou desde que você a abriu.',
                        details: { current: portfolio.updated_at },
                      },
                    ],
                    409,
                  ),
                );
              }

              const loaded = await repositories.finance.load();
              if (loaded.isFailure()) return loaded;
              const before = loaded.value;
              const ids = new Set(eventIds.value);
              const after = {
                ...before,
                movements: before.movements.filter(
                  (m) =>
                    m.event_id === null ||
                    m.event_id === undefined ||
                    !ids.has(m.event_id),
                ),
                entries: before.entries.map((e) =>
                  e.event_id !== null && e.event_id !== undefined && ids.has(e.event_id)
                    ? { ...e, event_id: null }
                    : e,
                ),
              };
              const saved = await repositories.finance.persist(
                fin.diffSnapshots(before, after),
              );
              if (saved.isFailure()) return saved;
            }

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
      { locks: ['finance', portfolioLock(id)] },
    );
  });
