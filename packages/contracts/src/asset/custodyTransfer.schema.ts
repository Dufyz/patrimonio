import { z } from 'zod';

import { dateOnly, uuid } from '../support/primitives.schema.js';

export const custodyTransferResourceSchema = z.object({
  id: uuid,
  portfolio_id: uuid,
  asset_id: uuid,
  from_institution_id: uuid,
  to_institution_id: uuid,
  transfer_date: dateOnly,
  note: z.string().nullable(),
  created_at: z.string(),
});

const scope = z.object({ portfolio_id: uuid, asset_id: uuid });

/**
 * Transferir o ativo de uma instituição para outra. A origem não vem no corpo:
 * é a custódia atual, que a api lê do livro — a tela mostrar uma origem e a api
 * usar outra seria a transferência gravada de um lugar onde o papel não está.
 */
export const transferCustodySchema = z.object({
  params: scope,
  body: z.object({
    to_institution_id: uuid,
    transfer_date: dateOnly,
    note: z.string().trim().max(280).nullable().optional(),
  }),
});

export const listCustodyTransfersSchema = z.object({ params: scope });

export const deleteCustodyTransferSchema = z.object({
  params: scope.extend({ transfer_id: uuid }),
});

export type TransferCustodyBody = z.infer<typeof transferCustodySchema>['body'];

export const transferCustodyResponseSchema = z.object({
  custody_transfer: custodyTransferResourceSchema,
  from_institution_name: z.string(),
  to_institution_name: z.string(),
  message: z.string(),
});

export type TransferCustodyResponse = z.infer<typeof transferCustodyResponseSchema>;
export type CustodyTransferResource = z.infer<typeof custodyTransferResourceSchema>;

export const listCustodyTransfersResponseSchema = z.object({
  custody_transfers: z.array(custodyTransferResourceSchema),
});
