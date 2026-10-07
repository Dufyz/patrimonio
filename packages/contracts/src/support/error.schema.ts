import { z } from 'zod';

/**
 * A forma de toda resposta de erro. O `request_id` é o que liga o 500 na tela à
 * linha de log que o explica.
 */
export const errorResponseSchema = z.object({
  message: z.string(),
  request_id: z.string(),
  /** Presente só quando o zod recusou o payload. */
  issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
});

export type ErrorResponse = z.infer<typeof errorResponseSchema>;
