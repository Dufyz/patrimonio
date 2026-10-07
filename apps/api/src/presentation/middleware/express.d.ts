declare global {
  namespace Express {
    interface Request {
      /** Posto por `requestContext`, o primeiro middleware da pilha. */
      requestId: string;
      /**
       * A query já validada pelo schema de `contracts`. Em Express 5 a `query`
       * é somente leitura, então o valor convertido mora aqui — e é este que o
       * controller lê, nunca o que chegou.
       */
      validatedQuery?: unknown;
    }
  }
}

export {};
