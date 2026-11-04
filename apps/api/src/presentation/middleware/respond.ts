import { isFinanceError } from '@patrimonio/application';
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
  if (isFinanceError(error)) {
    // Regra de Finanças: o `code` estável e as falhas da tentativa vão junto.
    response.status(error.statusCode).json({
      message: error.message,
      request_id: request.requestId,
      code: error.code,
      ...(error.field === undefined ? {} : { field: error.field }),
      ...(error.details === undefined ? {} : { details: error.details }),
      errors: error.errors,
    });
    return;
  }

  response
    .status(error.statusCode)
    .json({ message: error.message, request_id: request.requestId });
};

/** `If-Match: "3"` ou `3`: a versão que a tela viu. */
export const ifMatchVersion = (request: Request): number | undefined => {
  const header = request.header('If-Match');
  if (header === undefined) return undefined;
  const parsed = Number(header.replace(/^W\//, '').replace(/"/g, '').trim());
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
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
