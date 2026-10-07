import { z } from 'zod';

/**
 * Os tipos que atravessam o fio. Valor monetário viaja como **string**, nunca
 * como `number`: `numeric(20,8)` não cabe em `double`, e um arredondamento
 * silencioso no transporte é a classe de erro mais cara deste app.
 */
const DECIMAL = /^-?\d{1,20}(\.\d{1,12})?$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export const decimalString = z
  .string()
  .regex(DECIMAL, 'informe um número decimal, com ponto e sem separador de milhar');

export const nonNegativeDecimal = decimalString.refine(
  (value) => !value.startsWith('-'),
  'não pode ser negativo',
);

export const positiveDecimal = decimalString.refine(
  (value) => !value.startsWith('-') && Number(value) > 0,
  'precisa ser maior que zero',
);

/** Percentual de 0 a 100, como string. */
export const percentString = decimalString.refine((value) => {
  const parsed = Number(value);
  return parsed >= 0 && parsed <= 100;
}, 'precisa estar entre 0 e 100');

/**
 * Data de negócio é `YYYY-MM-DD`, nunca `Date` com fuso: um `Date` de
 * "2024-03-10" lido em outro fuso vira 09/03, e o deslocamento de um dia
 * reaparece no fechamento, na contagem de dia útil e na curva.
 */
export const dateOnly = z
  .string()
  .regex(DATE_ONLY, 'use o formato AAAA-MM-DD')
  .refine((value) => !Number.isNaN(Date.parse(value)), 'data inexistente');

export const uuid = z.string().uuid();

/** O nome que o usuário digita: sem espaço sobrando e não vazio. */
export const name = z.string().trim().min(1).max(120);

export const optionalText = z.string().trim().max(2_000);

/** Paginação das listagens: `{ data, page, limit, total }`, sem chave em volta. */
export const pagination = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(50),
});

export const paginatedOf = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    data: z.array(item),
    page: z.number().int().positive(),
    limit: z.number().int().positive(),
    total: z.number().int().nonnegative(),
  });

/**
 * A resposta das rotas que pedem trabalho ao pipeline: 202 com o id do evento
 * na outbox — que é também o `jobId` no BullMQ — e `already_queued` quando
 * outro pedido pendente com a mesma chave o absorveu.
 */
export const queuedWorkSchema = z.object({
  job_id: z.string(),
  dedupe_key: z.string(),
  already_queued: z.boolean(),
});

export type QueuedWork = z.infer<typeof queuedWorkSchema>;
