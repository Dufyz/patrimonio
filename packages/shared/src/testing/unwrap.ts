import type { Either } from '../either.js';

/**
 * `Either` é iterável — é assim que `yield*` funciona — e um `toEqual` sobre
 * ele compara iteráveis vazios em vez de valores, o que faz qualquer sucesso
 * parecer igual a qualquer outro. Todo teste afirma sobre o valor desembrulhado
 * por estas duas funções, nunca sobre o `Either` inteiro.
 */

const describeValue = (value: unknown): string => {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
};

export const unwrapSuccess = <F, S>(result: Either<F, S>): S => {
  if (result.isFailure()) {
    throw new Error(`esperava sucesso, veio falha: ${describeValue(result.value)}`);
  }

  return result.value;
};

export const unwrapFailure = <F, S>(result: Either<F, S>): F => {
  if (result.isSuccess()) {
    throw new Error(`esperava falha, veio sucesso: ${describeValue(result.value)}`);
  }

  return result.value;
};
