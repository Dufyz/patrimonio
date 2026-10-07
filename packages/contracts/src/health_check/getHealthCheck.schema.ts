import { z } from 'zod';

/**
 * Sem body, query nem params. O schema existe de todo jeito: é ele que a rota
 * valida e é dele que sai a documentação, então registrar faz parte de
 * adicionar rota.
 */
export const getHealthCheckSchema = z.object({
  body: z.object({}).optional(),
  query: z.object({}).optional(),
  params: z.object({}).optional(),
});

export const getLiveSchema = getHealthCheckSchema;
