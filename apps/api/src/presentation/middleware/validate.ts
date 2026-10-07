import type { RequestHandler } from 'express';
import type { ZodType } from 'zod';

/**
 * Valida body, query e params com o mesmo schema que o `web` usa no formulário
 * e que gera a documentação. Renomear um campo quebra o typecheck no mesmo
 * commit, nos dois lados.
 */
export const validate =
  (schema: ZodType): RequestHandler =>
  (request, response, next) => {
    const parsed = schema.safeParse({
      body: request.body,
      query: request.query,
      params: request.params,
    });

    if (!parsed.success) {
      response.status(400).json({
        message: 'Payload inválido',
        request_id: request.requestId,
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
      return;
    }

    const value = parsed.data as {
      body?: unknown;
      query?: unknown;
      params?: unknown;
    };

    // O que segue para o controller é o dado validado, não o que chegou.
    if (value.body !== undefined) request.body = value.body;
    if (value.params !== undefined) {
      Object.assign(request.params, value.params as Record<string, string>);
    }
    if (value.query !== undefined) {
      Object.defineProperty(request, 'validatedQuery', { value: value.query });
    }

    next();
  };
