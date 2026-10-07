import type { AppError } from '@patrimonio/application';
import type { Request, Response } from 'express';

/**
 * A falha esperada volta como `Either` e é traduzida aqui, com o `statusCode`
 * que o próprio erro carrega. O middleware de erro do Express continua sendo
 * rede de segurança para o inesperado, não caminho normal.
 */
export const sendFailure = (
  request: Request,
  response: Response,
  error: AppError,
): void => {
  response
    .status(error.statusCode)
    .json({ message: error.message, request_id: request.requestId });
};

/** A query já validada, convertida pelo schema de `contracts`. */
export const validatedQuery = <T>(request: Request): T => request.validatedQuery as T;

/**
 * O cabeçalho `Idempotency-Key`: clique duplo no botão de salvar chega como
 * dois requests com a mesma chave, e o índice único parcial transforma o
 * segundo em conflito em vez de em segundo lançamento.
 */
export const idempotencyKey = (request: Request): string | undefined => {
  const header = request.header('Idempotency-Key');
  return header === undefined || header.trim() === '' ? undefined : header.trim();
};
