import { totalAmount } from '@patrimonio/calc';
import { addDays } from '@patrimonio/domain';
import type { DateOnly, PayoutKind, TransactionKind } from '@patrimonio/domain';

/**
 * Uma linha de texto vira lançamento: `compra 100 itub4 36,84 ontem`. É o
 * caminho de quem lança todo dia e não quer abrir formulário — e por isso a
 * interpretação precisa aparecer antes de salvar, em pastilhas, para o erro ser
 * visto antes de virar patrimônio errado.
 *
 * A função é pura e recebe a data de hoje como parâmetro: "ontem" depende de
 * quando se pergunta, e nenhuma função pura deste projeto chama `new Date()`.
 */
export type TextChip = {
  readonly field: 'kind' | 'asset' | 'quantity' | 'unit_price' | 'trade_date' | 'total';
  readonly label: string;
  readonly value: string;
};

export type TextInterpretation = {
  readonly text: string;
  readonly kind: TransactionKind | null;
  readonly payout_kind: PayoutKind | null;
  readonly ticker: string | null;
  readonly quantity: string | null;
  readonly unit_price: string | null;
  readonly trade_date: DateOnly | null;
  readonly total_amount: string | null;
  readonly chips: readonly TextChip[];
  /** O que falta para salvar. Texto ambíguo não salva: pede desambiguação. */
  readonly missing: readonly string[];
  readonly ambiguous: boolean;
};

const KINDS: ReadonlyArray<readonly [RegExp, TransactionKind, PayoutKind | null]> = [
  [/^(compra|compro|comprei|comprar|c)$/i, 'buy', null],
  [/^(venda|vendo|vendi|vender|v)$/i, 'sell', null],
  [/^(dividendo|dividendos|div)$/i, 'payout', 'dividend'],
  [/^(jcp|jscp)$/i, 'payout', 'jcp'],
  [/^(rendimento|rendimentos|rend)$/i, 'payout', 'income'],
  [/^(juros|cupom)$/i, 'payout', 'interest'],
  [/^(amortizacao|amortização|amort)$/i, 'payout', 'amortization'],
  [/^(provento|proventos)$/i, 'payout', 'dividend'],
  [/^(aporte|aportar|deposito|depósito)$/i, 'deposit', null],
  [/^(resgate|resgatar|saque|retirada)$/i, 'withdrawal', null],
  [/^(transferencia|transferência|transferir|mover)$/i, 'transfer', null],
  [
    /^(desdobramento|grupamento|bonificacao|bonificação|evento)$/i,
    'corporate_event',
    null,
  ],
];

const KIND_LABELS: Record<TransactionKind, string> = {
  buy: 'Compra',
  sell: 'Venda',
  payout: 'Provento',
  deposit: 'Aporte',
  withdrawal: 'Resgate',
  transfer: 'Transferência',
  corporate_event: 'Evento',
};

const TICKER = /^[A-Za-z]{4}\d{1,2}$/;
const INTEGER = /^\d+$/;
/** Preço aceita vírgula e ponto: ninguém digita `36.84` no Brasil. */
const DECIMAL = /^\d{1,3}(\.\d{3})*,\d{1,8}$|^\d+,\d{1,8}$|^\d+\.\d{1,8}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const BR_DATE = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/;

const normalizeNumber = (token: string): string => {
  if (token.includes(',')) return token.replace(/\./g, '').replace(',', '.');
  return token;
};

const parseDate = (token: string, today: DateOnly): DateOnly | null => {
  const lowered = token.toLowerCase();

  if (lowered === 'hoje') return today;
  if (lowered === 'ontem') return addDays(today, -1);
  if (lowered === 'anteontem') return addDays(today, -2);

  if (ISO_DATE.test(token)) return token;

  const br = BR_DATE.exec(token);
  if (br !== null) {
    const day = br[1]?.padStart(2, '0') ?? '01';
    const month = br[2]?.padStart(2, '0') ?? '01';
    const rawYear = br[3];
    const year =
      rawYear === undefined
        ? today.slice(0, 4)
        : rawYear.length === 2
          ? `20${rawYear}`
          : rawYear;

    const candidate = `${year}-${month}-${day}`;
    return ISO_DATE.test(candidate) && !Number.isNaN(Date.parse(candidate))
      ? candidate
      : null;
  }

  return null;
};

/** Os tipos que exigem ativo, quantidade e preço para virarem lançamento. */
const NEEDS_ASSET: ReadonlySet<TransactionKind> = new Set<TransactionKind>([
  'buy',
  'sell',
  'payout',
  'transfer',
  'corporate_event',
]);

export const interpretTransactionText = (
  text: string,
  options: { readonly today: DateOnly },
): TextInterpretation => {
  const tokens = text
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0);

  let kind: TransactionKind | null = null;
  let payoutKind: PayoutKind | null = null;
  let ticker: string | null = null;
  let tradeDate: DateOnly | null = null;
  const numbers: string[] = [];

  for (const token of tokens) {
    if (kind === null) {
      const match = KINDS.find(([pattern]) => pattern.test(token));
      if (match !== undefined) {
        kind = match[1];
        payoutKind = match[2];
        continue;
      }
    }

    if (tradeDate === null) {
      const date = parseDate(token, options.today);
      if (date !== null) {
        tradeDate = date;
        continue;
      }
    }

    if (ticker === null && TICKER.test(token)) {
      ticker = token.toUpperCase();
      continue;
    }

    if (DECIMAL.test(token) || INTEGER.test(token)) {
      numbers.push(normalizeNumber(token));
      continue;
    }

    // Token que não é tipo, data, código nem número: pode ser um ticker de
    // formato diferente — Tesouro, por exemplo — e vira candidato a ativo.
    if (ticker === null && /^[A-Za-z][A-Za-z0-9-]{2,}$/.test(token)) {
      ticker = token.toUpperCase();
    }
  }

  // O primeiro número é a quantidade e o segundo é o preço: é a ordem em que se
  // fala ("100 itub4 a 36,84"), e inverter os dois produziria uma compra de 36
  // cotas a R$ 100.
  const quantity = numbers[0] ?? null;
  const unitPrice = numbers[1] ?? null;

  // O total é calculado em `Decimal`, como todo valor em reais: a formatação
  // acontece na tela, sobre a string.
  const total =
    quantity !== null && unitPrice !== null ? totalAmount(quantity, unitPrice) : null;

  const chips: TextChip[] = [];
  if (kind !== null) {
    chips.push({ field: 'kind', label: 'Tipo', value: KIND_LABELS[kind] });
  }
  if (ticker !== null) chips.push({ field: 'asset', label: 'Ativo', value: ticker });
  if (quantity !== null && unitPrice !== null) {
    chips.push({
      field: 'quantity',
      label: 'Quantidade e preço',
      value: `${quantity} × ${unitPrice}`,
    });
  } else if (quantity !== null) {
    chips.push({ field: 'quantity', label: 'Quantidade', value: quantity });
  }
  if (tradeDate !== null) {
    chips.push({ field: 'trade_date', label: 'Data', value: tradeDate });
  }
  if (total !== null) {
    chips.push({ field: 'total', label: 'Total', value: total });
  }

  const missing: string[] = [];
  if (kind === null) missing.push('tipo do lançamento');
  if (kind !== null && NEEDS_ASSET.has(kind) && ticker === null) missing.push('ativo');
  if (quantity === null) missing.push('quantidade');
  if (
    unitPrice === null &&
    kind !== null &&
    (kind === 'buy' || kind === 'sell' || kind === 'payout')
  ) {
    missing.push('preço unitário');
  }

  return {
    text,
    kind,
    payout_kind: payoutKind,
    ticker,
    quantity,
    unit_price: unitPrice,
    // Sem data escrita, o lançamento é de hoje: é o caso mais comum, e a
    // pastilha mostra qual data foi entendida.
    trade_date: tradeDate ?? options.today,
    total_amount: total,
    chips,
    missing,
    ambiguous: missing.length > 0,
  };
};
