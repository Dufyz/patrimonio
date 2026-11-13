import type { CardItemRequest } from '../api/invoice_write.js';
import type { InvoiceLineResource } from '../api/invoice.js';

/** CRT-07 · O que a fatura aceita fazer com uma linha e como monta cada pedido. */
export const CREDIT_SUBTYPES = [
  { id: 'devolucao', name: 'Devolução' },
  { id: 'estorno', name: 'Estorno' },
  { id: 'desconto', name: 'Desconto' },
  { id: 'cashback', name: 'Cashback' },
] as const;

export const CHARGE_SUBTYPES = [
  { id: 'juros', name: 'Juros' },
  { id: 'multa', name: 'Multa' },
  { id: 'iof', name: 'IOF' },
  { id: 'anuidade', name: 'Anuidade' },
] as const;

/** Fatura paga é somente leitura: nada de editar, excluir, estornar, mover, crédito ou encargo. */
export const readOnly = (status: string): boolean => status === 'paga';

/** Só compras e parcelas podem ser estornadas; crédito e encargo não. */
export const canReverse = (line: InvoiceLineResource, status: string): boolean =>
  !readOnly(status) &&
  (line.block === 'compras' || line.block === 'parcelas') &&
  !line.reversed;

/**
 * O estorno cai na primeira fatura sem pagamento a partir da exibida; se a
 * exibida já tem pagamento, na seguinte livre.
 */
export const reversalMonth = (shown: string, unpaid: readonly string[]): string | null =>
  [...unpaid].sort().find((m) => m >= shown) ?? null;

export const reversalRequest = (
  line: InvoiceLineResource,
  month: string,
): CardItemRequest => ({
  kind: 'credito',
  subtype: 'estorno',
  invoice_month: month,
  description: `Estorno: ${line.description}`,
  amount: line.amount,
  ...(line.category_id === null ? {} : { category_id: line.category_id }),
  reverses_id: line.id,
});

export type ItemDraft = {
  readonly kind: 'credito' | 'encargo';
  readonly subtype: CardItemRequest['subtype'];
  readonly description: string;
  readonly amount: string;
  readonly categoryId: string;
  readonly month: string;
};

export type ItemErrors = Partial<Record<'description' | 'amount' | 'categoryId', string>>;

const normalize = (v: string): string => v.trim().replace(/\./g, '').replace(',', '.');

export const validateItem = (d: ItemDraft): ItemErrors => {
  const errors: ItemErrors = {};
  if (d.description.trim() === '') errors.description = 'Informe a descrição.';
  const n = normalize(d.amount);
  if (!/^\d+(\.\d{1,2})?$/.test(n) || /^0+(\.0+)?$/.test(n))
    errors.amount = 'Informe um valor maior que zero.';
  if (d.kind === 'encargo' && d.categoryId === '')
    errors.categoryId = 'Encargo precisa de uma categoria de despesa.';
  return errors;
};

export const itemRequest = (d: ItemDraft): CardItemRequest => ({
  kind: d.kind,
  subtype: d.subtype,
  invoice_month: d.month,
  description: d.description.trim(),
  amount: normalize(d.amount),
  ...(d.kind === 'encargo' && d.categoryId !== '' ? { category_id: d.categoryId } : {}),
});
