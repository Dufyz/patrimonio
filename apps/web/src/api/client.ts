import { errorResponseSchema } from '@patrimonio/contracts';

/**
 * O pouco que todo pedido à `api` tem em comum.
 *
 * A resposta é validada pelo schema que a própria `api` usa para montá-la. Não
 * é cerimônia: renomear um campo quebra o typecheck dos dois lados no mesmo
 * commit, e uma resposta fora do contrato vira erro nomeado aqui em vez de
 * `undefined` dentro de uma célula da tabela três telas adiante.
 */
export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export type Parser<T> = { readonly parse: (value: unknown) => T };

export const request = async <T>(
  path: string,
  schema: Parser<T>,
  init: RequestInit = {},
): Promise<T> => {
  const response = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init.headers },
  });

  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const parsed = errorResponseSchema.safeParse(body);
    throw new ApiError(
      parsed.success ? parsed.data.message : `A api respondeu ${response.status}`,
      response.status,
    );
  }

  return schema.parse(body);
};
