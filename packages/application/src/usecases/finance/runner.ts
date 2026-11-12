import { createHash } from 'node:crypto';

import { finance as fin } from '@patrimonio/calc';
type Effect = fin.Effect;
type FinChanges = fin.FinChanges;
type FinRuleError = fin.FinRuleError;
type Warning = fin.Warning;
import type { FinSnapshot } from '@patrimonio/domain';
import { failure, success } from '@patrimonio/shared';
import type { Either } from '@patrimonio/shared';

import { ConflictError } from '../../errors/app-error.js';
import type { AppError } from '../../errors/app-error.js';
import { FinanceError } from '../../errors/finance-error.js';
import type { Clock } from '../../interfaces/clock.js';
import type { UnitOfWork } from '../../interfaces/unit-of-work.js';

export type FinanceDeps = {
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  /** UUID v7: o id cresce com o tempo, o que dá a ordem estável do livro. */
  readonly newId: () => string;
};

export type OpContext = { readonly today: string; readonly newId: () => string };

/** O que uma operação devolve: a foto nova, o dado da resposta e os avisos. */
export type OpOk = {
  readonly data: FinSnapshot;
  readonly result?: unknown;
  readonly warnings?: readonly Warning[] | undefined;
};

export type Op = (
  before: FinSnapshot,
  ctx: OpContext,
) => Either<readonly FinRuleError[], OpOk>;

/** O que o cliente enxerga: o corpo e o status HTTP já decididos. */
export type FinanceOutcome = {
  readonly status: number;
  readonly body: Record<string, unknown>;
  readonly replayed: boolean;
};

export type MutationOptions = {
  readonly name: string;
  readonly op: Op;
  /** Corpo da requisição, para o hash da idempotência. */
  readonly input: unknown;
  readonly preview?: boolean | undefined;
  readonly idempotencyKey?: string | undefined;
  /** `If-Match`: a versão que o cliente viu da entidade. */
  readonly ifMatch?:
    | {
        readonly get: (data: FinSnapshot) => number | undefined;
        readonly version: number;
      }
    | undefined;
  /** Status do sucesso (201 para criação). */
  readonly status?: number | undefined;
  /** Monta o corpo a partir do resultado da operação e da foto nova. */
  readonly respond?:
    ((ok: OpOk, after: FinSnapshot) => Record<string, unknown>) | undefined;
};

export const toFinanceError = (errors: readonly FinRuleError[]): FinanceError =>
  new FinanceError(
    errors.map((e) => ({
      code: e.code,
      message: e.message,
      field: e.field,
      details: e.details,
    })),
    errors[0]?.status ?? 422,
  );

const hashOf = (name: string, input: unknown): string =>
  `${name}:${createHash('sha256')
    .update(JSON.stringify(input ?? null))
    .digest('hex')}`;

const summarize = (
  changes: FinChanges,
): Record<string, { upserts: number; deletes: number }> =>
  Object.fromEntries(
    Object.entries(changes).map(([table, change]) => [
      table,
      { upserts: change.upserts.length, deletes: change.deletes.length },
    ]),
  );

/**
 * Toda escrita de Finanças passa por aqui: uma transação com trava, a foto lida
 * uma vez, a função pura do motor, a diferença gravada de uma vez. O preview
 * executa exatamente o mesmo caminho e só não grava (T-03).
 */
export const runMutation = async (
  deps: FinanceDeps,
  options: MutationOptions,
): Promise<Either<AppError, FinanceOutcome>> => {
  const today = deps.clock.today();
  const operation = hashOf(options.name, options.input);

  return deps.unitOfWork.run<AppError, FinanceOutcome>(
    async ({ finance }) => {
      if (options.idempotencyKey !== undefined && options.preview !== true) {
        const found = await finance.findIdempotent(options.idempotencyKey);
        if (found.isFailure()) return found;
        if (found.value !== null) {
          if (found.value.operation !== operation) {
            return failure(
              new FinanceError(
                [
                  {
                    code: 'IDEMPOTENCY_KEY_REUSED',
                    message: 'Esta Idempotency-Key já foi usada com outro conteúdo.',
                  },
                ],
                422,
              ),
            );
          }
          return success({
            status: found.value.status,
            body: found.value.body as Record<string, unknown>,
            replayed: true,
          });
        }
      }

      const loaded = await finance.load();
      if (loaded.isFailure()) return loaded;
      const before = loaded.value;

      if (options.ifMatch !== undefined) {
        const current = options.ifMatch.get(before);
        if (current !== undefined && current !== options.ifMatch.version) {
          return failure(
            new ConflictError(
              'O registro foi alterado em outro lugar. Recarregue e tente de novo.',
            ),
          );
        }
      }

      const applied = options.op(before, { today, newId: deps.newId });
      if (applied.isFailure()) return failure(toFinanceError(applied.value));

      const after = applied.value.data;
      const changes = fin.diffSnapshots(before, after);
      const effect: Effect = fin.effectBetween(
        before,
        after,
        today,
        applied.value.warnings ?? [],
      );

      if (options.preview === true) {
        return success({
          status: 200,
          body: { preview: true, effect, changes: summarize(changes) },
          replayed: false,
        });
      }

      if (!fin.isEmptyChange(changes)) {
        const saved = await finance.persist(changes);
        if (saved.isFailure()) return saved;
      }

      // A resposta devolve as versões novas: a gravação incrementa `version`.
      const reloaded = fin.isEmptyChange(changes) ? success(after) : await finance.load();
      if (reloaded.isFailure()) return reloaded;

      const body = {
        ...(options.respond === undefined
          ? { result: applied.value.result ?? null }
          : options.respond(applied.value, reloaded.value)),
        effect,
      };
      const status = options.status ?? 200;

      if (options.idempotencyKey !== undefined) {
        const stored = await finance.saveIdempotent(options.idempotencyKey, {
          operation,
          status,
          body,
        });
        if (stored.isFailure()) return stored;
      }

      return success({ status, body, replayed: false });
    },
    { lock: 'finance' },
  );
};

/** Leitura: uma transação curta, sem trava, uma consulta. */
export const runRead = async <T>(
  deps: FinanceDeps,
  read: (data: FinSnapshot, today: string) => T,
): Promise<Either<AppError, T>> =>
  deps.unitOfWork.run<AppError, T>(async ({ finance }) => {
    const loaded = await finance.load();
    if (loaded.isFailure()) return loaded;
    return success(read(loaded.value, deps.clock.today()));
  });

export const sha = hashOf;
