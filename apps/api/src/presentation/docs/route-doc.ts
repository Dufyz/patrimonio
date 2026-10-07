import type { ZodType } from 'zod';

/**
 * O registro das rotas. A documentação sai dos mesmos schemas zod que a api usa
 * para recusar uma request e que o `web` usa no formulário — então rota sem
 * entrada aqui não aparece em `/api/docs`, e registrar faz parte de adicionar
 * rota. Um teste compara o que está montado no Express com o que está aqui.
 */
export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

export type ResponseDoc = {
  readonly description: string;
  readonly schema?: ZodType;
};

export type RouteDoc = {
  readonly method: HttpMethod;
  /** Caminho sob `/api`, como o Express o registra. */
  readonly path: string;
  readonly tag: string;
  readonly summary: string;
  readonly request: ZodType;
  readonly responses: Readonly<Record<number, ResponseDoc>>;
};
