import type { DecimalParts } from './decimal.js';
import {
  groupThousands,
  isZero,
  magnitude,
  parseDecimal,
  roundToPlaces,
  shiftPoint,
  trimFraction,
} from './decimal.js';

/**
 * D-02 · Formatação de número.
 *
 * Comparar valores em coluna é o uso principal de toda a aplicação, então as
 * três regras que mandam aqui são: a vírgula alinha em qualquer magnitude, a
 * variação sempre leva sinal, e zero é zero enquanto ausência é traço. Confundir
 * os dois últimos é o erro que faz a tela mentir sem avisar.
 *
 * Toda função recebe a string que veio da `api` e devolve a string que vai para
 * a tela. Nenhuma converte para `number` no caminho.
 */

/** Valor indisponível. Nunca usado para zero. */
export const DASH = '—';

/** Marca de valor oculto (D-03). Largura fixa, para a coluna não se mexer. */
export const MASK = '•••••';

/** Sinal de menos tipográfico (U+2212), que alinha com o mais. */
export const MINUS = '−';

export type Sign = '' | '+' | typeof MINUS;

export type FormattedNumber = {
  /** Vazio quando o número não é uma variação. */
  readonly sign: Sign;
  /** O número sem sinal, com unidade: `R$ 1.204,10`, `0,25%`, `4,2 pp`. */
  readonly body: string;
  /** O que vai para a tela, sinal incluído. */
  readonly text: string;
  readonly masked: boolean;
  /** Falso quando a entrada era nula ou ilegível, e `text` é o traço. */
  readonly available: boolean;
};

export type NumberInput = string | null | undefined;

type BaseOptions = {
  /** Acrescenta o sinal mesmo quando o valor é positivo. */
  readonly signed?: boolean;
  /** D-03: esconde o valor em reais, preservando a largura. */
  readonly hidden?: boolean;
  readonly decimals?: number;
};

const unavailable = (): FormattedNumber => ({
  sign: '',
  body: DASH,
  text: DASH,
  masked: false,
  available: false,
});

const masked = (prefix: string): FormattedNumber => ({
  sign: '',
  body: prefix === '' ? MASK : `${prefix} ${MASK}`,
  text: prefix === '' ? MASK : `${prefix} ${MASK}`,
  masked: true,
  available: true,
});

const assemble = (
  parts: DecimalParts,
  body: string,
  signed: boolean,
): FormattedNumber => {
  const sign: Sign = parts.negative ? MINUS : signed ? '+' : '';
  return {
    sign,
    body,
    text: sign === '' ? body : `${sign}${body}`,
    masked: false,
    available: true,
  };
};

/** `1204.10` → `1.204,10`. A vírgula decimal e o ponto de milhar do pt-BR. */
const render = (parts: DecimalParts): string => {
  const integer = groupThousands(parts.integer);
  return parts.fraction === '' ? integer : `${integer},${parts.fraction}`;
};

/**
 * Arredonda para exibição e, se o resultado virar zero sem o valor ser zero,
 * abre casas até aparecer um dígito. Uma quantidade de `0,000000005` exibida
 * como `0,00` diz que não há nada ali, e há.
 */
const roundWithoutLying = (parts: DecimalParts, decimals: number): DecimalParts => {
  const rounded = roundToPlaces(parts, decimals);
  if (!isZero(rounded) || isZero(parts)) return rounded;

  for (let places = decimals + 1; places <= MAX_SIGNIFICANT_PLACES; places += 1) {
    const wider = roundToPlaces(parts, places);
    if (!isZero(wider)) return wider;
  }

  // Menor que uma parte em dez bilhões e ainda assim diferente de zero: mostra
  // o valor inteiro, que é feio e verdadeiro, em vez de um zero que é limpo e
  // falso.
  return parts;
};

const MAX_SIGNIFICANT_PLACES = 10;

/* -------------------------------------------------------------------------- */

/**
 * Valor em reais. `"1204.1"` → `R$ 1.204,10`; `"0"` → `R$ 0,00`; `null` → `—`.
 */
export const formatMoney = (
  value: NumberInput,
  options: BaseOptions = {},
): FormattedNumber => {
  if (options.hidden === true) return masked('R$');

  const parts = value === null || value === undefined ? null : parseDecimal(value);
  if (parts === null) return unavailable();

  const decimals = options.decimals ?? 2;
  return assemble(
    parts,
    `R$ ${render(roundToPlaces(parts, decimals))}`,
    options.signed === true,
  );
};

/**
 * Variação em reais: sempre com sinal, inclusive o positivo. `"-3170"` →
 * `−R$ 3.170,00`. Oculto, perde o `R$` junto com o valor — é o que a prancha
 * 18 mostra, e o percentual ao lado continua dizendo a direção.
 */
export const formatMoneyChange = (
  value: NumberInput,
  options: BaseOptions = {},
): FormattedNumber => {
  if (options.hidden === true) return masked('');
  return formatMoney(value, { ...options, signed: options.signed ?? true });
};

/**
 * Percentual a partir da razão que a `api` manda: `"0.0025"` → `0,25%`. O valor
 * nunca é escondido — a leitura relativa é o que sobra quando os reais somem.
 */
export const formatPercent = (
  value: NumberInput,
  options: Omit<BaseOptions, 'hidden'> = {},
): FormattedNumber => {
  const parts = value === null || value === undefined ? null : parseDecimal(value);
  if (parts === null) return unavailable();

  const decimals = options.decimals ?? 2;
  const asPercent = roundToPlaces(shiftPoint(parts, 2), decimals);
  return assemble(parts, `${render(asPercent)}%`, options.signed === true);
};

/**
 * Diferença em pontos percentuais: `"4.2"` → `+4,2 pp`. Já chega em pontos, sem
 * conversão — é diferença entre dois percentuais, não uma razão.
 */
export const formatPoints = (
  value: NumberInput,
  options: Omit<BaseOptions, 'hidden'> = {},
): FormattedNumber => {
  const parts = value === null || value === undefined ? null : parseDecimal(value);
  if (parts === null) return unavailable();

  const decimals = options.decimals ?? 1;
  return assemble(
    parts,
    `${render(roundToPlaces(parts, decimals))} pp`,
    options.signed ?? true,
  );
};

/**
 * Quantidade. Inteira aparece inteira — `500`, e não `500,00`, como a prancha
 * 05 mostra —, fracionária aparece com duas casas, e fração pequena demais abre
 * casas em vez de virar zero.
 */
export const formatQuantity = (
  value: NumberInput,
  options: Omit<BaseOptions, 'hidden'> = {},
): FormattedNumber => {
  const parts = value === null || value === undefined ? null : parseDecimal(value);
  if (parts === null) return unavailable();

  const decimals = options.decimals ?? 2;
  const rounded = roundWithoutLying(parts, decimals);
  // Ou todas as casas, ou nenhuma: `22,40` mantém o zero porque a coluna
  // alinha pela vírgula, e `500` não ganha vírgula porque não tem fração.
  const shown = isZero({ ...rounded, integer: '0' })
    ? { ...rounded, fraction: '' }
    : rounded;

  return assemble(shown, render(shown), options.signed === true);
};

/**
 * Valor da cota. Casas fixas e muitas: a cota é a base do retorno, e truncá-la
 * na exibição esconde justamente a variação de um dia.
 */
export const formatQuota = (
  value: NumberInput,
  options: BaseOptions = {},
): FormattedNumber => {
  if (options.hidden === true) return masked('');

  const parts = value === null || value === undefined ? null : parseDecimal(value);
  if (parts === null) return unavailable();

  return assemble(
    parts,
    render(roundToPlaces(parts, options.decimals ?? 8)),
    options.signed === true,
  );
};

const TIERS = [
  { places: 9, suffix: 'B' },
  { places: 6, suffix: 'M' },
  { places: 3, suffix: 'k' },
] as const;

/**
 * Forma compacta, só onde não cabe o número inteiro: eixo de gráfico e barra
 * lateral. `"318900"` → `318,9k`. Zeros à direita somem, então `300000` é
 * `300k` e não `300,0k`.
 */
export const formatCompact = (
  value: NumberInput,
  options: BaseOptions = {},
): FormattedNumber => {
  if (options.hidden === true) return masked('');

  const parts = value === null || value === undefined ? null : parseDecimal(value);
  if (parts === null) return unavailable();

  const decimals = options.decimals ?? 1;
  const digits = magnitude(parts);
  const tier = TIERS.find((candidate) => digits > candidate.places);

  if (tier === undefined) {
    const rounded = roundToPlaces(parts, decimals);
    const fraction = trimFraction(rounded.fraction, 0);
    const shown = { ...rounded, fraction };
    return assemble(shown, render(shown), options.signed === true);
  }

  const scaled = roundToPlaces(shiftPoint(parts, -tier.places), decimals);
  const shown = { ...scaled, fraction: trimFraction(scaled.fraction, 0) };
  return assemble(shown, `${render(shown)}${tier.suffix}`, options.signed === true);
};
