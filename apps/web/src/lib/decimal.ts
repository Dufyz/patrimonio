/**
 * D-02 · Aritmética decimal sobre string, para exibição.
 *
 * O contrato manda dinheiro como string justamente para que ele não passe por
 * `number` (`Arquitetura e tecnologias`, seção "O que atravessa o fio"). Então
 * a formatação também não pode converter: `Number("0.1") + Number("0.2")` é o
 * bug que a decisão inteira existe para evitar, e arredondar com
 * `toFixed` herda o mesmo problema um dígito depois.
 *
 * O que mora aqui é o mínimo para exibir: separar o sinal, mover a vírgula e
 * arredondar. Nenhuma soma, nenhuma multiplicação entre dois valores — todo
 * número derivado vem calculado da `api`.
 */

export type DecimalParts = {
  readonly negative: boolean;
  /** Dígitos inteiros, sem zeros à esquerda. Nunca vazio: zero é `'0'`. */
  readonly integer: string;
  /** Dígitos fracionários, sem zeros à direita significativos removidos. */
  readonly fraction: string;
};

const DECIMAL = /^[+-]?(\d+)(?:\.(\d+))?$/;

const stripLeadingZeros = (digits: string): string => {
  const stripped = digits.replace(/^0+/, '');
  return stripped === '' ? '0' : stripped;
};

/**
 * Aceita o que o contrato produz: `"1204.1"`, `"-3170"`, `"0"`, `"+0.25"`.
 * Devolve `null` para qualquer outra coisa — incluindo `""`, `"abc"` e notação
 * científica —, e quem chama decide o que mostrar no lugar.
 */
export const parseDecimal = (value: string): DecimalParts | null => {
  const match = DECIMAL.exec(value.trim());
  if (match === null) return null;

  const integer = match[1] ?? '0';
  const fraction = match[2] ?? '';

  return {
    negative: value.trim().startsWith('-'),
    integer: stripLeadingZeros(integer),
    fraction,
  };
};

export const isZero = (parts: DecimalParts): boolean =>
  parts.integer === '0' && /^0*$/.test(parts.fraction);

/**
 * Move a vírgula. `places` positivo multiplica por dez elevado a `places`
 * (razão para percentual: duas casas à direita), negativo divide (modo
 * compacto: três casas à esquerda por tier).
 */
export const shiftPoint = (parts: DecimalParts, places: number): DecimalParts => {
  if (places === 0) return parts;

  const digits = parts.integer + parts.fraction;
  const pointAt = parts.integer.length + places;

  if (pointAt <= 0) {
    return {
      negative: parts.negative,
      integer: '0',
      fraction: '0'.repeat(-pointAt) + digits,
    };
  }

  if (pointAt >= digits.length) {
    return {
      negative: parts.negative,
      integer: stripLeadingZeros(digits + '0'.repeat(pointAt - digits.length)),
      fraction: '',
    };
  }

  return {
    negative: parts.negative,
    integer: stripLeadingZeros(digits.slice(0, pointAt)),
    fraction: digits.slice(pointAt),
  };
};

/**
 * Arredonda para `places` casas, meio para cima em valor absoluto — a regra que
 * a planilha e o extrato da corretora usam. `-0,005` vira `-0,01`, não `-0,00`.
 */
export const roundToPlaces = (parts: DecimalParts, places: number): DecimalParts => {
  if (parts.fraction.length <= places) {
    return { ...parts, fraction: parts.fraction.padEnd(places, '0') };
  }

  const kept = parts.integer + parts.fraction.slice(0, places);
  const nextDigit = parts.fraction[places] ?? '0';

  const rounded =
    nextDigit >= '5' ? incrementDigits(kept) : { digits: kept, grew: false as const };

  const integerLength = parts.integer.length + (rounded.grew ? 1 : 0);

  return {
    negative: parts.negative,
    integer: stripLeadingZeros(rounded.digits.slice(0, integerLength)),
    fraction: rounded.digits.slice(integerLength),
  };
};

const incrementDigits = (
  digits: string,
): { readonly digits: string; readonly grew: boolean } => {
  const out = digits.split('');

  for (let index = out.length - 1; index >= 0; index -= 1) {
    const digit = out[index] ?? '0';
    if (digit === '9') {
      out[index] = '0';
      continue;
    }
    out[index] = String(Number(digit) + 1);
    return { digits: out.join(''), grew: false };
  }

  return { digits: `1${out.join('')}`, grew: true };
};

/**
 * Agrupa milhares com ponto. Feito sobre string e não com `Intl`: o valor pode
 * ter mais dígitos do que um `number` representa sem perda, e um patrimônio
 * truncado em silêncio é exatamente o erro que ninguém percebe.
 */
export const groupThousands = (integer: string): string => {
  let out = '';
  for (let index = integer.length; index > 0; index -= 3) {
    const start = Math.max(0, index - 3);
    out = integer.slice(start, index) + (out === '' ? '' : `.${out}`);
  }
  return out === '' ? '0' : out;
};

/** Quantos dígitos o valor tem antes da vírgula, ignorando o sinal. */
export const magnitude = (parts: DecimalParts): number =>
  parts.integer === '0' ? 0 : parts.integer.length;

/** Remove zeros à direita da parte fracionária, preservando ao menos `keep`. */
export const trimFraction = (fraction: string, keep: number): string => {
  let end = fraction.length;
  while (end > keep && fraction[end - 1] === '0') end -= 1;
  return fraction.slice(0, end);
};
