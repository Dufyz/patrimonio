import type { InvoiceBlock, InvoiceLineResource } from '../api/invoice.js';
import { scaled, unscaled } from './statement_view.js';

/** CRT-04/05 · O que a tela de Fatura decide sobre as linhas que a api devolve. */
export const BLOCKS: readonly { id: InvoiceBlock; label: string; empty: string }[] = [
  { id: 'compras', label: 'Compras do período', empty: 'nenhuma nesta fatura' },
  {
    id: 'parcelas',
    label: 'Parcelas de compras anteriores',
    empty: 'nenhuma nesta fatura',
  },
  { id: 'creditos', label: 'Créditos e ajustes', empty: 'nenhum nesta fatura' },
  { id: 'encargos', label: 'Encargos', empty: 'nenhum nesta fatura' },
];

export const LINE_TYPE_LABEL: Readonly<Record<InvoiceBlock, string>> = {
  compras: 'Compra',
  parcelas: 'Parcela',
  creditos: 'Crédito',
  encargos: 'Encargo',
};

export const subtotal = (lines: readonly InvoiceLineResource[]): string =>
  unscaled(lines.reduce((acc, l) => acc + scaled(l.amount), 0n));

/** Busca por descrição e categoria, e filtro por tipo de linha; não mexe no total da fatura. */
export const filterInvoiceLines = (
  lines: readonly InvoiceLineResource[],
  query: string,
  types: readonly InvoiceBlock[],
  categoryName: (id: string | null) => string,
): readonly InvoiceLineResource[] => {
  const q = query.trim().toLowerCase();
  return lines.filter(
    (l) =>
      (types.length === 0 || types.includes(l.block)) &&
      (q === '' ||
        l.description.toLowerCase().includes(q) ||
        categoryName(l.category_id).toLowerCase().includes(q)),
  );
};

/** Anterior e próxima fatura; o navegador para na mais antiga e na última prevista. */
export const neighbours = (
  months: readonly string[],
  current: string,
): { readonly prev: string | null; readonly next: string | null } => {
  const i = months.indexOf(current);
  return {
    prev: i > 0 ? (months[i - 1] ?? null) : null,
    next: i >= 0 && i < months.length - 1 ? (months[i + 1] ?? null) : null,
  };
};

/** O extrato completo: a soma com sinal (créditos negativos) é igual ao total da fatura. */
export const exportInvoiceRows = (
  lines: readonly InvoiceLineResource[],
  categoryName: (id: string | null) => string,
): readonly (readonly string[])[] => [
  ['Data', 'Descrição', 'Tipo', 'Categoria', 'Parcela', 'Valor'],
  ...lines.map((l) => [
    l.date,
    l.description,
    LINE_TYPE_LABEL[l.block],
    categoryName(l.category_id),
    l.installment === null ? '' : `${l.installment.no}/${l.installment.total}`,
    l.block === 'creditos' ? `-${l.amount}` : l.amount,
  ]),
];
