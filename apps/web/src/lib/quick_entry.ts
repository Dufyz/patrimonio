/**
 * NAV-10 · Lançamento por texto na busca: `aporte 80 divo11 32,40`.
 *
 * É uma função pura: o texto entra, os campos saem, e nada abre modal aqui. O
 * padrão é `tipo quantidade ativo [preço]`. O que não casa com ele — verbo
 * desconhecido, número que não é número, ativo sem cara de código — devolve
 * `null` e o texto cai nos resultados comuns da busca. Ambíguo não vira ação.
 */

export type QuickEntryVerb = 'buy' | 'sell' | 'payout';

export type QuickEntry = {
  readonly verb: QuickEntryVerb;
  /** Quantidade de cotas; no provento, o valor recebido. Decimal com ponto. */
  readonly amount: string;
  /** O código, em maiúsculas. */
  readonly ticker: string;
  /** Preço unitário, decimal com ponto; nulo quando o texto não o traz. */
  readonly price: string | null;
};

const VERBS: Readonly<Record<string, QuickEntryVerb>> = {
  aporte: 'buy',
  compra: 'buy',
  resgate: 'sell',
  venda: 'sell',
  provento: 'payout',
};

export const VERB_LABEL: Readonly<Record<QuickEntryVerb, string>> = {
  buy: 'aporte',
  sell: 'resgate',
  payout: 'provento',
};

/** Código de papel da B3: quatro letras, um ou dois dígitos e, às vezes, uma letra (PETR4, BOVA11, ITUB4F). */
const TICKER = /^[A-Za-z]{4}\d{1,2}[A-Za-z]?$/;

/**
 * `80` → `80`, `32,40` → `32.40`, `1.250,5` → `1250.5`. O ponto só vale como
 * separador de milhar quando há vírgula decimal ou três dígitos depois dele;
 * `32.40` já vem com ponto decimal. Qualquer outra coisa é `null`.
 */
export const parseDecimal = (text: string): string | null => {
  if (!/^\d[\d.,]*$/.test(text)) return null;

  const comma = text.lastIndexOf(',');
  if (comma !== -1) {
    const integer = text.slice(0, comma).replace(/\./g, '');
    const fraction = text.slice(comma + 1);
    if (!/^\d+$/.test(integer) || !/^\d{1,8}$/.test(fraction)) return null;
    return `${integer}.${fraction}`;
  }

  if (/^\d{1,3}(\.\d{3})+$/.test(text)) return text.replace(/\./g, '');
  if (/^\d+(\.\d{1,8})?$/.test(text)) return text;
  return null;
};

const isPositive = (decimal: string): boolean => /[1-9]/.test(decimal);

export const parseQuickEntry = (text: string): QuickEntry | null => {
  const parts = text.trim().split(/\s+/);
  if (parts.length < 3 || parts.length > 4) return null;

  const [word, rawAmount, rawTicker, rawPrice] = parts;
  const verb = VERBS[(word ?? '').toLowerCase()];
  if (verb === undefined || rawAmount === undefined || rawTicker === undefined) {
    return null;
  }

  const amount = parseDecimal(rawAmount);
  if (amount === null || !isPositive(amount) || !TICKER.test(rawTicker)) return null;

  let price: string | null = null;
  if (rawPrice !== undefined) {
    price = parseDecimal(rawPrice);
    if (price === null || !isPositive(price)) return null;
  }

  return { verb, amount, ticker: rawTicker.toUpperCase(), price };
};

/** `32.40` → `R$ 32,40`, para o rótulo do resultado. */
const brl = (decimal: string): string => {
  const [whole = '0', fraction = ''] = decimal.split('.');
  return `R$ ${whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${fraction.padEnd(2, '0')}`;
};

/** `80` → `80`; `0.5` → `0,5`: a quantidade como a pessoa a escreveu. */
const plain = (decimal: string): string => decimal.replace('.', ',');

/** "Lançar aporte de 80 DIVO11 a R$ 32,40": a frase do resultado no topo. */
export const quickEntryLabel = (entry: QuickEntry): string => {
  if (entry.verb === 'payout') {
    return `Lançar provento de ${brl(entry.amount)} de ${entry.ticker}`;
  }
  const price = entry.price === null ? '' : ` a ${brl(entry.price)}`;
  return `Lançar ${VERB_LABEL[entry.verb]} de ${plain(entry.amount)} ${entry.ticker}${price}`;
};
