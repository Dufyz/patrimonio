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

/**
 * A fonte recusou o pedido: chave inválida, endpoint que saiu do ar, cota do
 * mês esgotada. É 400 porque repetir não muda a resposta — alguém precisa
 * renovar a chave ou revisar a configuração, e insistir só queima o que sobrou
 * da cota. A mensagem carrega o que a fonte disse, que é o que a tela de dados
 * de mercado mostra em vez de um código.
 */
export class MarketSourceRejectedError extends AppError {
  constructor(message: string) {
    super(message, 400);
  }
}

/**
 * A fonte respondeu, e a resposta não tem a forma que o provedor conhece: campo
 * que sumiu, número com vírgula onde havia ponto, data em outro formato,
 * envelope diferente. É 400 de propósito — reexecutar contra uma API que mudou
 * de contrato não muda o resultado, então o `defineStage` encerra o job em vez
 * de insistir, e ninguém grava número errado enquanto o retry roda.
 *
 * O trecho recebido viaja no erro: seis meses depois, "o patrimônio ficou
 * estranho" se responde com o que a fonte de fato devolveu naquele dia.
 */
export class FormatChangedError extends AppError {
  constructor(
    /** A fonte, como ela aparece em `asset_price.source`. */
    readonly source: string,
    /** O campo culpado, no caminho em que ele vive na resposta. */
    readonly field: string,
    reason: string,
    /** O trecho recebido, já recortado para caber num log. */
    readonly received: string,
  ) {
    super(`${source}: ${field} ${reason}`, 400);
  }

  override toJSON(): {
    message: string;
    statusCode: number;
    name: string;
    source: string;
    field: string;
    received: string;
  } {
    return {
      ...super.toJSON(),
      source: this.source,
      field: this.field,
      received: this.received,
    };
  }
}

export const isAppError = (value: unknown): value is AppError =>
  value instanceof AppError;

export const isFormatChangedError = (value: unknown): value is FormatChangedError =>
  value instanceof FormatChangedError;
