/**
 * `Either<F, S>` é como toda falha viaja no sistema. Nenhuma camada lança
 * exceção para a de cima: repositórios, gateways e casos de uso devolvem
 * `Either`, e quem chama decide com `isFailure()`.
 *
 * O encadeamento usa o gerador `either`: `yield*` sobre um `Either` devolve o
 * valor do sucesso ou encerra a função com a falha, e o tipo de erro do caso de
 * uso é a união dos erros de cada passo, inferida pelo compilador.
 */

const FAILURE = 'failure';
const SUCCESS = 'success';

export class Failure<out F> {
  readonly kind = FAILURE;

  constructor(readonly value: F) {}

  isFailure(): this is Failure<F> {
    return true;
  }

  isSuccess(): false {
    return false;
  }

  /**
   * `yield this` entrega a falha ao driver do gerador, que encerra o fluxo.
   * O `never` do retorno é o que faz o TypeScript entender que a linha
   * seguinte a um `yield*` de falha é inalcançável.
   */
  *[Symbol.iterator](): Generator<Failure<F>, never, unknown> {
    yield this;
    throw new Error('Either: o driver do gerador não retomou uma falha');
  }
}

export class Success<out S> {
  readonly kind = SUCCESS;

  constructor(readonly value: S) {}

  isFailure(): false {
    return false;
  }

  isSuccess(): this is Success<S> {
    return true;
  }

  /**
   * Sucesso não rende nada: o `yield*` sobre ele devolve o valor e o fluxo
   * segue. É o oposto da falha, e é por isso que este gerador não tem `yield`.
   */
  // eslint-disable-next-line require-yield
  *[Symbol.iterator](): Generator<never, S, unknown> {
    return this.value;
  }
}

export type Either<F, S> = Failure<F> | Success<S>;

export const failure = <F>(value: F): Failure<F> => new Failure(value);
export const success = <S>(value: S): Success<S> => new Success(value);

/** Sucesso sem valor, para a operação que só precisa dizer "deu certo". */
export const ok = (): Success<void> => new Success(undefined);

export const isEither = (value: unknown): value is Either<unknown, unknown> =>
  value instanceof Failure || value instanceof Success;

/** O tipo de erro acumulado pelos `yield*` de um corpo de gerador. */
type FailuresOf<Yielded> = Yielded extends Failure<infer F> ? F : never;

type EitherBody<Args extends readonly unknown[], Yielded, Returned> = (
  ...args: Args
) => AsyncGenerator<Yielded, Returned, unknown> | Generator<Yielded, Returned, unknown>;

/**
 * Transforma um corpo de gerador na função do caso de uso.
 *
 * ```ts
 * export const createTransaction = (deps: CreateTransactionDeps) =>
 *   either(async function* (body: CreateTransactionBody) {
 *     const portfolio = yield* await deps.portfolios.findById(body.portfolio_id);
 *     return yield* await deps.apply(planTransaction(portfolio, body));
 *   });
 * ```
 *
 * O primeiro `yield` de falha encerra o fluxo e vira o `Either` de saída.
 */
export const either =
  <Args extends readonly unknown[], Yielded extends Failure<unknown>, Returned>(
    body: EitherBody<Args, Yielded, Returned>,
  ) =>
  async (...args: Args): Promise<Either<FailuresOf<Yielded>, Returned>> => {
    const iterator = body(...args);
    const step = await iterator.next();

    if (step.done === true) return success(step.value);

    // Um `yield` só acontece quando há falha: o fluxo para aqui.
    return step.value as unknown as Failure<FailuresOf<Yielded>>;
  };

/** A mesma composição, sem promessa, para o código puro de `calc` e `domain`. */
export const eitherSync =
  <Args extends readonly unknown[], Yielded extends Failure<unknown>, Returned>(
    body: (...args: Args) => Generator<Yielded, Returned, unknown>,
  ) =>
  (...args: Args): Either<FailuresOf<Yielded>, Returned> => {
    const iterator = body(...args);
    const step = iterator.next();

    if (step.done === true) return success(step.value);

    return step.value as unknown as Failure<FailuresOf<Yielded>>;
  };

/**
 * Agrega uma lista de `Either` num `Either` de lista. Para na primeira falha,
 * que é o que o caso de uso quer: o tipo de erro continua sendo o erro do
 * passo, e não uma lista de erros que o middleware não saberia traduzir.
 * Quando interessa ver todas as falhas, use `partitionEithers`.
 */
export const mergeMany = <F, S>(items: readonly Either<F, S>[]): Either<F, S[]> => {
  const values: S[] = [];

  for (const item of items) {
    if (item.isFailure()) return item;
    values.push(item.value);
  }

  return success(values);
};

/** `mergeMany` sobre promessas, resolvidas em paralelo. */
export const mergeManyAsync = async <F, S>(
  items: readonly Promise<Either<F, S>>[],
): Promise<Either<F, S[]>> => mergeMany(await Promise.all(items));

/** Separa falhas e sucessos sem descartar nenhum dos dois. */
export const partitionEithers = <F, S>(
  items: readonly Either<F, S>[],
): { failures: F[]; successes: S[] } => {
  const failures: F[] = [];
  const successes: S[] = [];

  for (const item of items) {
    if (item.isFailure()) failures.push(item.value);
    else successes.push(item.value);
  }

  return { failures, successes };
};

/** Aplica uma função ao sucesso, preservando a falha. */
export const mapSuccess = <F, S, T>(
  item: Either<F, S>,
  map: (value: S) => T,
): Either<F, T> => (item.isFailure() ? item : success(map(item.value)));

/** Aplica uma função à falha, preservando o sucesso. */
export const mapFailure = <F, S, G>(
  item: Either<F, S>,
  map: (value: F) => G,
): Either<G, S> => (item.isFailure() ? failure(map(item.value)) : item);
