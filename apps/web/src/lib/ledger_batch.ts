import type { BookRowResource } from '@patrimonio/contracts';
import { decimalToCents } from '../finance/lib/money.js';
import type { Cents } from '../finance/lib/money.js';

/**
 * LAN-08 · O que uma linha do livro aceita em lote. Quem sabe a rota de cada
 * tipo é este módulo: a tela só pergunta "isso pode?" e mostra o porquê.
 */

/** Tipos que têm rota de exclusão própria. Pagamento de fatura sai pela fatura. */
const DELETABLE: ReadonlySet<BookRowResource['kind']> = new Set([
  'RECEITA',
  'DESPESA',
  'TRANSFERENCIA',
  'APORTE',
  'RESGATE',
  'PROVENTO',
  'EVENTO',
]);

export const canDelete = (row: BookRowResource): boolean => DELETABLE.has(row.kind);

/** O caminho da exclusão da linha. */
export const deletePath = (row: BookRowResource): string | null => {
  switch (row.kind) {
    case 'RECEITA':
    case 'DESPESA':
      return `/api/finance/entries/${row.id}`;
    case 'TRANSFERENCIA':
      return `/api/finance/transfers/${row.id}`;
    case 'APORTE':
    case 'RESGATE':
    case 'PROVENTO':
    case 'EVENTO':
      return `/api/transactions/${row.id}`;
    case 'PAGAMENTO_FATURA':
      return null;
  }
};

/** Receita e despesa lançadas ou previstas são as que se recategorizam e se movem. */
export const isEntryRow = (row: BookRowResource): boolean =>
  (row.kind === 'RECEITA' || row.kind === 'DESPESA') && row.entry !== null;

/** Centavos, sem ponto flutuante: a soma do que a confirmação promete. */
const toCents = (value: string): bigint => {
  const negative = value.startsWith('-');
  const [whole = '0', fraction = ''] = value.replace('-', '').split('.');
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0').slice(0, 2));
  return negative ? -cents : cents;
};

const fromCents = (cents: bigint): string => {
  const abs = cents < 0n ? -cents : cents;
  const text = `${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
  return cents < 0n ? `-${text}` : text;
};

/** O valor total afetado pelo lote, em valor absoluto de cada linha. */
export const batchTotal = (rows: readonly BookRowResource[]): string =>
  fromCents(rows.reduce((sum, row) => sum + toCents(row.amount ?? '0'), 0n));

type EntryPayment = {
  readonly source_type: string;
  readonly source_id: string;
  readonly amount?: string;
};

type EntryShape = {
  readonly kind: string;
  readonly description: string;
  readonly date: string;
  readonly category_id: string;
  readonly amount: string;
  readonly payments: readonly EntryPayment[];
  readonly installments?: number;
  readonly status?: string;
  readonly note?: string | null;
};

const entryOf = (row: BookRowResource): EntryShape => row.entry as unknown as EntryShape;

const entryBody = (
  entry: EntryShape,
  patch: Partial<EntryShape>,
): Record<string, unknown> => ({
  kind: entry.kind,
  description: entry.description,
  date: entry.date,
  category_id: entry.category_id,
  amount: entry.amount,
  payments: entry.payments.map((p) => ({
    source_type: p.source_type,
    source_id: p.source_id,
    ...(p.amount === undefined ? {} : { amount: p.amount }),
  })),
  ...(entry.status === undefined ? {} : { status: entry.status }),
  ...(entry.note === undefined ? {} : { note: entry.note }),
  ...patch,
});

/** O corpo do `PUT /finance/entries/:id` que só troca a categoria. */
export const recategorizeBody = (
  row: BookRowResource,
  categoryId: string,
): Record<string, unknown> => entryBody(entryOf(row), { category_id: categoryId });

/** Mover de conta troca só a origem em conta; pagamento no cartão não se move. */
export const canMove = (row: BookRowResource): boolean =>
  isEntryRow(row) && entryOf(row).payments.every((p) => p.source_type === 'conta');

export const moveBody = (
  row: BookRowResource,
  accountId: string,
): Record<string, unknown> => {
  const entry = entryOf(row);
  return entryBody(entry, {
    payments: entry.payments.map((p) => ({ ...p, source_id: accountId })),
  });
};

/** O cartão de uma despesa paga só no cartão; `null` se paga em conta ou dividida. */
export const cardOf = (row: BookRowResource): string | null => {
  if (!isEntryRow(row) || row.kind !== 'DESPESA') return null;
  const payments = entryOf(row).payments;
  const [only] = payments;
  return payments.length === 1 && only?.source_type === 'cartao' ? only.source_id : null;
};

/** LAN-07 · Mover de fatura e Estornar valem para despesa lançada no cartão. */
export const canMoveInvoice = (row: BookRowResource): boolean =>
  row.situation === 'lancado' && cardOf(row) !== null;

/** O corpo do estorno: a fatura do mês da compra, pelo valor todo, ligado à origem. */
export const reversalBody = (
  row: BookRowResource,
): {
  readonly cardId: string;
  readonly invoice_month: string;
  readonly description: string;
  readonly amount: string;
  readonly reverses_id: string;
} | null => {
  const cardId = cardOf(row);
  if (cardId === null) return null;
  return {
    cardId,
    invoice_month: row.date.slice(0, 7),
    description: `Estorno: ${row.description}`.slice(0, 120),
    amount: entryOf(row).amount,
    reverses_id: row.id,
  };
};

/**
 * LAN-07.3 · O efeito de excluir uma receita ou despesa lançada paga numa só
 * conta: o saldo dela antes → depois. Sem conta única (cartão, dividida) ou sem
 * saldo conhecido, não há o que mostrar, e a tela não inventa.
 */
export const deleteEffect = (
  row: BookRowResource,
  balances: ReadonlyMap<string, { readonly name: string; readonly balance: string }>,
): readonly { label: string; before: Cents; after: Cents }[] => {
  if (!isEntryRow(row) || row.situation !== 'lancado') return [];

  const payments = entryOf(row).payments;
  const [only] = payments;
  if (payments.length !== 1 || only?.source_type !== 'conta') return [];

  const account = balances.get(only.source_id);
  const amount = decimalToCents(entryOf(row).amount);
  const before = account === undefined ? null : decimalToCents(account.balance);
  if (account === undefined || amount === null || before === null) return [];

  // Excluir uma despesa devolve o dinheiro à conta; excluir uma receita o tira.
  const after = row.kind === 'DESPESA' ? before + amount : before - amount;

  return [{ label: `Saldo de ${account.name}`, before, after }];
};

/**
 * LAN-07.4 · "Pular este mês" só existe para previsto que nasce de uma
 * recorrência: pular é desligar aquele mês dela, não apagar um lançamento.
 */
export const skippable = (
  row: BookRowResource,
): { readonly recurringId: string; readonly month: string } | null => {
  if (row.situation !== 'previsto' || row.entry === null) return null;
  const id = (row.entry as { recurring_id?: unknown }).recurring_id;
  return typeof id === 'string' && id !== ''
    ? { recurringId: id, month: row.date.slice(0, 7) }
    : null;
};
