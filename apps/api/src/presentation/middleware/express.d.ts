declare global {
  namespace Express {
    interface Request {
      /** Posto por `requestContext`, o primeiro middleware da pilha. */
      requestId: string;
    }
  }
}

export {};
