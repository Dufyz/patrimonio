import { describe, expect, it } from 'vitest';

import {
  AppError,
  BadRequestError,
  ConflictError,
  DatabaseError,
  ExternalServiceError,
  InvalidParameterError,
  MarketDataUnavailableError,
  NotFoundError,
  TooManyRequestsError,
  UnauthorizedError,
  isAppError,
} from './app-error.js';

describe('hierarquia de erros', () => {
  it.each([
    [new InvalidParameterError('x'), 400],
    [new BadRequestError('x'), 400],
    [new UnauthorizedError(), 401],
    [new NotFoundError('x'), 404],
    [new ConflictError('x'), 409],
    [new TooManyRequestsError(), 429],
    [new DatabaseError('x'), 500],
    [new ExternalServiceError('x'), 502],
    [new MarketDataUnavailableError('x'), 503],
  ])('$constructor.name responde com o status da tabela', (error, statusCode) => {
    expect(error.statusCode).toBe(statusCode);
    expect(isAppError(error)).toBe(true);
  });

  it('4xx é falha definitiva e 5xx é transitória, que é o que o worker usa', () => {
    expect(new NotFoundError('x').isClientError).toBe(true);
    expect(new NotFoundError('x').isTransient).toBe(false);

    expect(new MarketDataUnavailableError('x').isTransient).toBe(true);
    expect(new DatabaseError('x').isTransient).toBe(true);
  });

  it('o padrão de AppError é 400', () => {
    expect(new AppError('x').statusCode).toBe(400);
  });

  it('toJSON carrega o nome da especialização, para o log', () => {
    expect(new ConflictError('carteira já existe').toJSON()).toEqual({
      name: 'ConflictError',
      message: 'carteira já existe',
      statusCode: 409,
    });
  });

  it('um Error comum não passa por AppError', () => {
    expect(isAppError(new Error('x'))).toBe(false);
  });
});
