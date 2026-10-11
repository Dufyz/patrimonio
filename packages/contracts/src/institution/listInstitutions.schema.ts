import { z } from 'zod';

export const listInstitutionsSchema = z.object({
  query: z.object({}).optional(),
});
