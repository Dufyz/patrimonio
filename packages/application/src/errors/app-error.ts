/**
 * Todo erro que atravessa camada é um `AppError` dentro de um `Either`, nunca
 * uma exceção lançada. O `statusCode` existe por dois motivos: o middleware do
 * Express o devolve como está, e o `defineStage` do worker decide por ele se o
 * job reexecuta — 4xx é falha definitiva, 5xx é transitória.
 */
export class AppError {
  constructor(
    readonly message: string,
    readonly statusCode: number = 400,
  ) {}

  /** Erro do cliente: reexecutar não muda o resultado. */
  get isClientError(): boolean {
    return this.statusCode >= 400 && this.statusCode < 500;
  }

  /** Erro nosso ou de terceiro: pode valer a pena tentar de novo. */
  get isTransient(): boolean {
    return this.statusCode >= 500;
  }

  toJSON(): { message: string; statusCode: number; name: string } {
    return {
      message: this.message,
      statusCode: this.statusCode,
      name: this.constructor.name,
    };
  }
}

/** Parâmetro com forma certa e valor sem sentido: data futura, percentual acima de 100. */
export class InvalidParameterError extends AppError {
  constructor(message: string) {
    super(message, 400);
  }
}

export class BadRequestError extends AppError {
  constructor(message: string) {
    super(message, 400);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Não autenticado') {
    super(message, 401);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string) {
    super(message, 404);
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409);
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message = 'Muitas requisições') {
    super(message, 429);
  }
}

export class DatabaseError extends AppError {
  constructor(message: string) {
    super(message, 500);
  }
}

export class ExternalServiceError extends AppError {
  constructor(message: string) {
    super(message, 502);
  }
}

/**
 * O provedor de mercado está fora do ar. 503 tem consequência prática: o
 * worker reexecuta com backoff, enquanto um ticker inexistente (400) falha de
 * uma vez.
 */
export class MarketDataUnavailableError extends AppError {
  constructor(message: string) {
    super(message, 503);
  }
}

export const isAppError = (value: unknown): value is AppError =>
  value instanceof AppError;
