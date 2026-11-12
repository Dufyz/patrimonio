import { z } from 'zod';

import {
  dateOnly,
  nonNegativeDecimal,
  positiveDecimal,
  uuid,
} from '../support/primitives.schema.js';

/**
 * Finanças. Valor monetário é string decimal (`"1234.50"`), data é `AAAA-MM-DD`
 * e mês é `AAAA-MM`. Toda escrita aceita `?preview=true`: executa a mesma função
 * da gravação e devolve o "antes → depois" sem gravar nada.
 */
export const finMonth = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'use o formato AAAA-MM');
export const finKind = z.enum(['receita', 'despesa']);
export const finRecurringKind = z.enum(['receita', 'despesa', 'aporte']);
export const finSourceType = z.enum(['conta', 'cartao']);
export const finEntryStatus = z.enum(['prevista', 'lancada']);
export const finScope = z.enum(['esta', 'seguintes', 'todas']);
const text = (max: number) => z.string().trim().min(1).max(max);
const flag = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true')
  .optional();

/** Comum às escritas. */
export const writeQuery = z.object({ preview: flag });

const idParam = (key: string) => z.object({ [key]: uuid });
const written = <T extends z.ZodRawShape>(params: T, body?: z.ZodTypeAny) =>
  z.object({
    params: z.object(params),
    query: writeQuery.optional(),
    ...(body ? { body } : {}),
  });

// ─── Categorias ──────────────────────────────────────────────────────────────
export const categoryBody = z.object({
  name: text(60),
  kind: finKind,
  color: z.string().regex(/^[a-z][a-z0-9-]{1,30}$/, 'use o nome de uma cor da paleta'),
});
export const listFinCategoriesSchema = z.object({
  query: z.object({ include_archived: flag }).optional(),
});
export const createFinCategorySchema = z.object({
  body: categoryBody,
  query: writeQuery.optional(),
});
export const updateFinCategorySchema = written({ id: uuid }, categoryBody);
export const archiveSchema = z.object({ archived: z.boolean() });
export const archiveFinCategorySchema = written({ id: uuid }, archiveSchema);
export const deleteFinCategorySchema = written({ id: uuid });
export const categoryBreakdownSchema = z.object({
  query: z.object({ kind: finKind.default('despesa'), from: dateOnly, to: dateOnly }),
});

// ─── Contas ──────────────────────────────────────────────────────────────────
export const accountBody = z.object({
  name: text(60),
  type: z.enum(['corrente', 'poupanca', 'carteira']),
  institution: z.string().trim().max(60).nullable().optional(),
  role: z.string().trim().max(160).optional(),
  role_tag: z.string().trim().max(30).nullable().optional(),
  opening_amount: nonNegativeDecimal,
  opening_date: dateOnly,
});
export const listAccountsSchema = z.object({
  query: z.object({ month: finMonth.optional(), include_archived: flag }).optional(),
});
export const createAccountSchema = z.object({
  body: accountBody,
  query: writeQuery.optional(),
});
export const updateAccountSchema = written({ id: uuid }, accountBody);
export const archiveAccountSchema = written({ id: uuid }, archiveSchema);
export const deleteAccountSchema = written({ id: uuid });
export const statementSchema = z.object({
  params: idParam('id'),
  query: z
    .object({
      month: finMonth.optional(),
      from: dateOnly.optional(),
      to: dateOnly.optional(),
    })
    .optional(),
});

// ─── Transferências ──────────────────────────────────────────────────────────
export const transferBody = z.object({
  from_account_id: uuid,
  to_account_id: uuid,
  amount: positiveDecimal,
  date: dateOnly,
  note: z.string().trim().max(200).nullable().optional(),
});
export const createTransferSchema = z.object({
  body: transferBody,
  query: writeQuery.optional(),
});
export const updateTransferSchema = written({ id: uuid }, transferBody);
export const deleteTransferSchema = written({ id: uuid });

// ─── Cartões e faturas ───────────────────────────────────────────────────────
export const cardBody = z.object({
  name: text(60),
  last4: z
    .string()
    .regex(/^\d{4}$/, 'os 4 últimos dígitos')
    .optional(),
  pay_account_id: uuid,
  limit_amount: nonNegativeDecimal,
  closing_day: z.number().int().min(1).max(31),
  due_day: z.number().int().min(1).max(31),
});
export const listCardsSchema = z.object({ query: z.object({}).optional() });
export const createCardSchema = z.object({
  body: cardBody,
  query: writeQuery.optional(),
});
export const updateCardSchema = written({ id: uuid }, cardBody);
export const archiveCardSchema = written({ id: uuid }, archiveSchema);
export const deleteCardSchema = written({ id: uuid });
export const invoiceSchema = z.object({
  params: z.object({ id: uuid, month: finMonth }),
});
export const payInvoiceSchema = z.object({
  params: z.object({ id: uuid, month: finMonth }),
  query: writeQuery.optional(),
  body: z.object({
    account_id: uuid.optional(),
    date: dateOnly,
    amount: positiveDecimal,
  }),
});
export const deleteInvoicePaymentSchema = written({ payment_id: uuid });
export const cardItemBody = z.object({
  kind: z.enum(['credito', 'encargo']),
  subtype: z.enum([
    'devolucao',
    'estorno',
    'desconto',
    'cashback',
    'juros',
    'multa',
    'iof',
    'anuidade',
  ]),
  invoice_month: finMonth,
  description: text(120),
  amount: positiveDecimal,
  date: dateOnly.optional(),
  category_id: uuid.optional(),
  /** Estorno: o lançamento ou item da fatura que este crédito desfaz. */
  reverses_id: uuid.optional(),
});
export const createCardItemSchema = written({ id: uuid }, cardItemBody);
export const deleteCardItemSchema = written({ item_id: uuid });
export const moveInvoiceBody = z.object({ invoice_month: finMonth });
export const moveEntryInvoiceSchema = written({ id: uuid }, moveInvoiceBody);
export const moveCardItemInvoiceSchema = written({ item_id: uuid }, moveInvoiceBody);

// ─── Recorrentes ─────────────────────────────────────────────────────────────
const source = z.object({ type: finSourceType, id: uuid });
export const recurringBody = z.object({
  name: text(80),
  kind: finRecurringKind,
  /** Aporte não tem categoria (LIV-11). */
  category_id: uuid.nullable().optional(),
  portfolio_id: uuid.nullable().optional(),
  asset_id: uuid.nullable().optional(),
  source,
  second_source: source.nullable().optional(),
  covers_up_to: positiveDecimal.nullable().optional(),
  day: z.number().int().min(1).max(31),
  mode: z.enum(['manual', 'automatico']),
  amount: positiveDecimal,
  active: z.boolean().optional(),
});
export const listRecurringsSchema = z.object({ query: z.object({}).optional() });
export const createRecurringSchema = z.object({
  body: recurringBody,
  query: writeQuery.optional(),
});
export const updateRecurringSchema = written({ id: uuid }, recurringBody);
export const recurringActiveSchema = written(
  { id: uuid },
  z.object({ active: z.boolean() }),
);
export const skipRecurringSchema = written({ id: uuid }, z.object({ month: finMonth }));
export const deleteRecurringSchema = written({ id: uuid });

// ─── Lançamentos ─────────────────────────────────────────────────────────────
const paymentBody = z.object({
  source_type: finSourceType,
  source_id: uuid,
  amount: positiveDecimal.optional(),
});
export const entryBody = z.object({
  kind: finKind,
  description: text(120),
  date: dateOnly,
  category_id: uuid,
  amount: positiveDecimal,
  payments: z.array(paymentBody).min(1).max(2),
  installments: z.number().int().min(1).max(24).optional(),
  status: finEntryStatus.optional(),
  note: z.string().trim().max(500).nullable().optional(),
});
export const listEntriesSchema = z.object({
  query: z.object({
    month: finMonth.optional(),
    from: dateOnly.optional(),
    to: dateOnly.optional(),
    kind: finKind.optional(),
    category_id: uuid.optional(),
    source_id: uuid.optional(),
    status: finEntryStatus.optional(),
    q: z.string().trim().max(120).optional(),
    group: z.enum(['dia', 'categoria', 'origem']).optional(),
    cursor: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  }),
});
const csvList = <T extends z.ZodTypeAny>(item: T) =>
  z
    .union([z.array(item), item.transform((value) => [value])])
    .optional();
export const LEDGER_KIND_VALUES = [
  'RECEITA',
  'DESPESA',
  'TRANSFERENCIA',
  'PAGAMENTO_FATURA',
  'APORTE',
  'RESGATE',
  'PROVENTO',
  'EVENTO',
] as const;
/** LIV-02 · O livro unificado: filtros, agrupamento e cursor. */
export const listBookSchema = z.object({
  query: z.object({
    month: finMonth.optional(),
    from: dateOnly.optional(),
    to: dateOnly.optional(),
    tipo: csvList(z.enum(LEDGER_KIND_VALUES)),
    situacao: csvList(z.enum(['previsto', 'lancado'])),
    conta: csvList(uuid),
    cartao: csvList(uuid),
    carteira: csvList(uuid),
    ativo: csvList(uuid),
    categoria: csvList(uuid),
    classe: csvList(uuid),
    q: z.string().trim().max(120).optional(),
    groupBy: z.enum(['dia', 'tipo', 'conta_carteira']).optional(),
    cursor: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  }),
});
export const exportEntriesSchema = z.object({
  query: listEntriesSchema.shape.query.omit({ cursor: true, limit: true, group: true }),
});
export const getEntrySchema = z.object({ params: idParam('id') });
export const createEntrySchema = z.object({
  body: entryBody,
  query: writeQuery.optional(),
});
export const updateEntrySchema = z.object({
  params: idParam('id'),
  query: writeQuery.optional(),
  body: entryBody.extend({ scope: finScope.optional() }),
});
export const confirmEntrySchema = z.object({
  params: idParam('id'),
  query: writeQuery.optional(),
  body: z
    .object({
      date: dateOnly.optional(),
      amount: positiveDecimal.optional(),
      payments: z.array(paymentBody).min(1).max(2).optional(),
    })
    .default({}),
});
export const deleteEntrySchema = z.object({
  params: idParam('id'),
  query: z.object({ preview: flag, scope: finScope.optional() }).optional(),
});

// ─── Visão geral, busca, rotina ──────────────────────────────────────────────
export const finOverviewSchema = z.object({
  query: z.object({ month: finMonth.optional() }).optional(),
});
/** LIV-09 · O patrimônio total e o livre após faturas, de uma leitura só. */
/** LIV-10 · Saldo previsto numa data e a série do período. */
export const finForecastSchema = z.object({
  query: z.object({
    date: dateOnly.optional(),
    from: dateOnly.optional(),
    to: dateOnly.optional(),
  }),
});
export const finWealthSchema = z.object({ query: z.object({}).optional() });
/** A foto inteira de Finanças, como o front a lê para montar as telas. */
export const finSnapshotSchema = z.object({ query: z.object({}).optional() });
export const finSearchSchema = z.object({
  query: z.object({
    q: z.string().trim().min(1).max(120),
    limit: z.coerce.number().int().min(1).max(20).optional(),
  }),
});
export const syncFinanceSchema = z.object({ query: writeQuery.optional() });

/** Corpo de resposta de escrita e de preview: o "antes → depois" vai junto. */
export const effectSchema = z
  .object({
    accounts: z.array(z.unknown()),
    invoices: z.array(z.unknown()),
    months: z.array(z.unknown()),
    installments: z.array(z.unknown()),
    warnings: z.array(z.unknown()),
  })
  .passthrough();
export const finWriteResponseSchema = z.object({ effect: effectSchema }).passthrough();
export const finPreviewResponseSchema = z.object({
  preview: z.literal(true),
  effect: effectSchema,
  changes: z.record(z.string(), z.unknown()),
});
export const finErrorResponseSchema = z.object({
  message: z.string(),
  request_id: z.string(),
  code: z.string().optional(),
  field: z.string().optional(),
  details: z.record(z.string(), z.string()).optional(),
  errors: z
    .array(
      z.object({ code: z.string(), message: z.string(), field: z.string().optional() }),
    )
    .optional(),
});
export const finReadResponseSchema = z.object({}).passthrough();

export type EntryBody = z.infer<typeof entryBody>;
export type CategoryBody = z.infer<typeof categoryBody>;
export type AccountBody = z.infer<typeof accountBody>;
export type CardBody = z.infer<typeof cardBody>;
export type RecurringBody = z.infer<typeof recurringBody>;
export type TransferBody = z.infer<typeof transferBody>;
export type CardItemBody = z.infer<typeof cardItemBody>;
