import {
  corporateEventPreviewSchema,
  corporateEventResourceSchema,
  payoutPreviewSchema,
  transactionPreviewSchema,
  transactionResourceSchema,
} from '@patrimonio/contracts';
import type {
  ConfirmPayoutBody,
  CreatePayoutBody,
  DismissPayoutBody,
  CorporateEventPreviewBody,
  CorporateEventPreviewResource,
  CreateTransactionBody,
  PayoutPreviewResource,
  TransactionPreviewResource,
  TransactionResource,
  UpdateTransactionBody,
} from '@patrimonio/contracts';

import { request } from './client.js';
import type { Parser } from './client.js';

/**
 * T-10 · Os pedidos que os modais de lançamento fazem.
 *
 * Duas famílias, e a diferença entre elas é o que a tela nunca pode esquecer:
 * **preview** não grava nada e roda o mesmo plano que a gravação roda — por isso
 * os números do modal são os que ficam gravados —, e **salvar** grava, leva
 * `Idempotency-Key` e enfileira o recálculo. Nenhuma das duas é otimista: o
 * lançamento só aparece na tela depois que a `api` confirma.
 */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** `{ chave: recurso, ... }` → o recurso, validado pelo schema da própria `api`. */
const inside = <T>(key: string, schema: Parser<T>): Parser<T> => ({
  parse: (value) => schema.parse(isRecord(value) ? value[key] : undefined),
});

/**
 * O recibo de uma gravação: o que a tela diz ao fechar o modal. `queued` é se o
 * recálculo foi enfileirado — a posição só muda na tela quando ele termina, e
 * dizê-lo é mais honesto que deixar a pessoa procurando o número novo.
 */
export type SaveReceipt = {
  readonly message: string;
  readonly queued: boolean;
  /** O lançamento gravado, quando a resposta traz um só. */
  readonly transaction: TransactionResource | null;
};

const receiptParser: Parser<SaveReceipt> = {
  parse: (value) => {
    if (!isRecord(value) || typeof value['message'] !== 'string') {
      throw new Error('A api respondeu a gravação fora do contrato');
    }

    const recalculation = value['recalculation'];
    const queued = Array.isArray(recalculation)
      ? recalculation.length > 0
      : recalculation !== null && recalculation !== undefined;

    const transaction = value['transaction'];

    return {
      message: value['message'],
      queued,
      transaction:
        transaction === undefined || transaction === null
          ? null
          : transactionResourceSchema.parse(transaction),
    };
  },
};

const post = (body: unknown, signal?: AbortSignal): RequestInit => ({
  method: 'POST',
  body: JSON.stringify(body),
  ...(signal === undefined ? {} : { signal }),
});

const save = (
  path: string,
  method: 'POST' | 'PATCH',
  body: unknown,
  attemptKey: string,
): Promise<SaveReceipt> =>
  request(path, receiptParser, {
    method,
    body: JSON.stringify(body),
    headers: { 'Idempotency-Key': attemptKey },
  });

/* -------------------------------------------------------------------------- */
/* Preview                                                                    */

export const previewTransaction = (
  body: CreateTransactionBody,
  signal?: AbortSignal,
): Promise<TransactionPreviewResource> =>
  request(
    '/api/transactions/preview',
    inside('preview', transactionPreviewSchema),
    post(body, signal),
  );

export const previewCorporateEvent = (
  body: CorporateEventPreviewBody,
  signal?: AbortSignal,
): Promise<CorporateEventPreviewResource> =>
  request(
    '/api/transactions/preview',
    inside('preview', corporateEventPreviewSchema),
    post(body, signal),
  );

export const previewPayout = (
  body: CreatePayoutBody,
  signal?: AbortSignal,
): Promise<PayoutPreviewResource> =>
  request('/api/transactions/payouts/preview', payoutPreviewSchema, post(body, signal));

export const previewUpdate = (
  id: string,
  body: UpdateTransactionBody,
  signal?: AbortSignal,
): Promise<TransactionPreviewResource> =>
  request(
    `/api/transactions/${id}/preview`,
    inside('preview', transactionPreviewSchema),
    post(body, signal),
  );

/* -------------------------------------------------------------------------- */
/* Gravação                                                                   */

export const createTransaction = (
  body: CreateTransactionBody,
  attemptKey: string,
): Promise<SaveReceipt> => save('/api/transactions', 'POST', body, attemptKey);

export const createPayout = (
  body: CreatePayoutBody,
  attemptKey: string,
): Promise<SaveReceipt> => save('/api/transactions/payouts', 'POST', body, attemptKey);

export const updateTransaction = (
  id: string,
  body: UpdateTransactionBody,
  attemptKey: string,
): Promise<SaveReceipt> => save(`/api/transactions/${id}`, 'PATCH', body, attemptKey);

export const confirmPayout = (
  id: string,
  body: ConfirmPayoutBody,
  attemptKey: string,
): Promise<SaveReceipt> =>
  save(`/api/transactions/${id}/confirm`, 'POST', body, attemptKey);

/** "Não foi pago": o provento sai do livro e o motivo fica registrado. */
export const dismissPayout = (
  id: string,
  body: DismissPayoutBody,
  attemptKey: string,
): Promise<SaveReceipt> =>
  save(`/api/transactions/${id}/dismiss`, 'POST', body, attemptKey);

/**
 * Registrar e confirmar, em sequência: o fluxo de `POST /corporate-events` e
 * `POST /corporate-events/:id/confirm`. Registrar de novo o mesmo evento não cria
 * uma segunda linha, então repetir depois de uma falha no meio é seguro; se só a
 * confirmação falhar, o evento fica registrado, aguardando confirmação.
 */
export const applyCorporateEvent = async (
  body: CorporateEventPreviewBody,
  attemptKey: string,
): Promise<SaveReceipt> => {
  const registered = await request(
    '/api/corporate-events',
    inside('event', corporateEventResourceSchema),
    {
      method: 'POST',
      body: JSON.stringify({
        asset_id: body.asset_id,
        kind: body.event_kind,
        record_date: body.record_date,
        ratio_from: body.ratio_from,
        ratio_to: body.ratio_to,
      }),
      headers: { 'Idempotency-Key': attemptKey },
    },
  );

  return save(`/api/corporate-events/${registered.id}/confirm`, 'POST', {}, attemptKey);
};

/* -------------------------------------------------------------------------- */
/* Leitura                                                                    */

/** O lançamento que o modal de edição abre. */
export const fetchTransaction = (
  id: string,
  signal?: AbortSignal,
): Promise<TransactionResource> =>
  request(`/api/transactions/${id}`, inside('transaction', transactionResourceSchema), {
    ...(signal === undefined ? {} : { signal }),
  });
